import {
	App,
	CachedMetadata,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	TAbstractFile,
	TFile,
} from "obsidian";

interface StatusDatesSettings {
	trackedProperty: string;
	preserveAllDates: boolean;
	finalStatuses: string[];
}

const DEFAULT_SETTINGS: StatusDatesSettings = {
	trackedProperty: "status",
	preserveAllDates: false,
	finalStatuses: [],
};

function localDate(): string {
	const now = new Date();
	const offset = now.getTimezoneOffset() * 60_000;
	return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function normalizeStatus(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function propertyMap(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function trackedValue(
	frontmatter: unknown,
	trackedProperty: string,
): string | null {
	return normalizeStatus(propertyMap(frontmatter)?.[trackedProperty]);
}

export default class StatusDatesPlugin extends Plugin {
	settings: StatusDatesSettings = DEFAULT_SETTINGS;
	private previousValueByPath = new Map<string, string | null>();
	private processing = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new StatusDatesSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("modify", (file) =>
					this.captureValueBeforeModify(file),
				),
			);

			this.registerEvent(
				this.app.vault.on("create", (file) => this.captureNewFile(file)),
			);

			this.registerEvent(
				this.app.metadataCache.on(
					"changed",
					(file, _data, cache) => void this.handleMetadataChange(file, cache),
				),
			);

			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) =>
					this.handleRename(file, oldPath),
				),
			);

			this.registerEvent(
				this.app.vault.on("delete", (file) => this.handleDelete(file)),
			);
		});
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<StatusDatesSettings> | null;
		const trackedProperty =
			typeof saved?.trackedProperty === "string" && saved.trackedProperty.trim()
				? saved.trackedProperty.trim()
				: DEFAULT_SETTINGS.trackedProperty;
		const preserveAllDates =
			typeof saved?.preserveAllDates === "boolean"
				? saved.preserveAllDates
				: DEFAULT_SETTINGS.preserveAllDates;
		const finalStatuses = Array.isArray(saved?.finalStatuses)
			? saved.finalStatuses.filter(
					(status): status is string =>
						typeof status === "string" && status.trim().length > 0,
				)
			: DEFAULT_SETTINGS.finalStatuses;

		this.settings = { trackedProperty, preserveAllDates, finalStatuses };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	resetPendingChanges(): void {
		this.previousValueByPath.clear();
	}

	private captureValueBeforeModify(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.processing.has(file.path)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		this.previousValueByPath.set(
			file.path,
			trackedValue(cache?.frontmatter, this.settings.trackedProperty),
		);
	}

	private captureNewFile(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.previousValueByPath.set(file.path, null);
	}

	private async handleMetadataChange(
		file: TFile,
		cache: CachedMetadata,
	): Promise<void> {
		if (file.extension !== "md") return;

		const path = file.path;
		const newStatus = trackedValue(
			cache.frontmatter,
			this.settings.trackedProperty,
		);

		if (this.processing.has(path)) {
			return;
		}

		if (!this.previousValueByPath.has(path)) return;
		const oldStatus = this.previousValueByPath.get(path) ?? null;
		this.previousValueByPath.delete(path);

		if (!newStatus || oldStatus === newStatus) return;

		this.processing.add(path);
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const properties = propertyMap(frontmatter);
				if (!properties) return;
				const propertyExists = Object.keys(properties).includes(newStatus);
				const isFinal =
					this.settings.preserveAllDates ||
					this.settings.finalStatuses.includes(newStatus);

				if (!isFinal || !propertyExists) {
					properties[newStatus] = localDate();
				}
			});
		} finally {
			this.processing.delete(path);
		}
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;

		const status = this.previousValueByPath.get(oldPath);
		this.previousValueByPath.delete(oldPath);
		if (status !== undefined) this.previousValueByPath.set(file.path, status);
	}

	private handleDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.previousValueByPath.delete(file.path);
		this.processing.delete(file.path);
	}
}

class StatusDatesSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly statusDatesPlugin: StatusDatesPlugin) {
		super(app, statusDatesPlugin);
	}

	display(): void {
		this.renderLegacySettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Tracked property",
				desc: "Property whose value changes should be dated.",
				control: {
					type: "text",
					key: "trackedProperty",
					placeholder: "status",
				},
			},
			{
				name: "Preserve first date for every value",
				desc: "When enabled, every tracked value keeps the date it was first recorded.",
				control: {
					type: "toggle",
					key: "preserveAllDates",
				},
			},
			{
				name: "Final statuses",
				desc: "Comma-separated statuses whose first recorded date must never be overwritten. Leave empty to overwrite every status date.",
				visible: () => !this.statusDatesPlugin.settings.preserveAllDates,
				render: (setting: Setting) => {
					setting.addText((text) =>
						text
							.setPlaceholder("Published, rejected")
							.setValue(
								this.statusDatesPlugin.settings.finalStatuses.join(", "),
							)
							.onChange(async (value) => {
								this.statusDatesPlugin.settings.finalStatuses = value
									.split(",")
									.map((status) => status.trim())
									.filter(Boolean);
								await this.statusDatesPlugin.saveSettings();
							}),
					);
				},
			},
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "trackedProperty" && typeof value === "string") {
			this.statusDatesPlugin.settings.trackedProperty =
				value.trim() || DEFAULT_SETTINGS.trackedProperty;
			this.statusDatesPlugin.resetPendingChanges();
		} else if (key === "preserveAllDates" && typeof value === "boolean") {
			this.statusDatesPlugin.settings.preserveAllDates = value;
		} else {
			return;
		}

		await this.statusDatesPlugin.saveSettings();
		const declarativeTab = this as unknown as {
			refreshDomState?: () => void;
		};
		declarativeTab.refreshDomState?.();
	}

	private renderLegacySettings(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			.setName("Tracked property")
			.setDesc("Property whose value changes should be dated.")
			.addText((text) =>
				text
					.setPlaceholder("Status")
					.setValue(this.statusDatesPlugin.settings.trackedProperty)
					.onChange(async (value) => {
						this.statusDatesPlugin.settings.trackedProperty =
							value.trim() || DEFAULT_SETTINGS.trackedProperty;
						this.statusDatesPlugin.resetPendingChanges();
						await this.statusDatesPlugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Preserve first date for every value")
			.setDesc(
				"When enabled, every tracked value keeps the date it was first recorded.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.statusDatesPlugin.settings.preserveAllDates)
					.onChange(async (value) => {
						this.statusDatesPlugin.settings.preserveAllDates = value;
						await this.statusDatesPlugin.saveSettings();
						this.renderLegacySettings();
					}),
			);

		if (!this.statusDatesPlugin.settings.preserveAllDates) {
			new Setting(this.containerEl)
				.setName("Final statuses")
				.setDesc(
					"Comma-separated statuses whose first recorded date must never be overwritten. Leave empty to overwrite every status date.",
				)
				.addText((text) =>
					text
						.setPlaceholder("Published, rejected")
						.setValue(
							this.statusDatesPlugin.settings.finalStatuses.join(", "),
						)
						.onChange(async (value) => {
							this.statusDatesPlugin.settings.finalStatuses = value
								.split(",")
								.map((status) => status.trim())
								.filter(Boolean);
							await this.statusDatesPlugin.saveSettings();
						}),
				);
		}
	}
}
