import {
	App,
	CachedMetadata,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";

interface StatusDatesSettings {
	trackedProperty: string;
	finalStatuses: string[];
}

const DEFAULT_SETTINGS: StatusDatesSettings = {
	trackedProperty: "status",
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

export default class StatusDatesPlugin extends Plugin {
	settings: StatusDatesSettings = DEFAULT_SETTINGS;
	private trackedValueByPath = new Map<string, string | null>();
	private processing = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new StatusDatesSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.initializeTrackedValueCache();

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
		const finalStatuses = Array.isArray(saved?.finalStatuses)
			? saved.finalStatuses.filter(
					(status): status is string =>
						typeof status === "string" && status.trim().length > 0,
				)
			: DEFAULT_SETTINGS.finalStatuses;

		this.settings = { trackedProperty, finalStatuses };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	initializeTrackedValueCache(): void {
		this.trackedValueByPath.clear();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			this.trackedValueByPath.set(
				file.path,
				normalizeStatus(
					cache?.frontmatter?.[this.settings.trackedProperty],
				),
			);
		}
	}

	private async handleMetadataChange(
		file: TFile,
		cache: CachedMetadata,
	): Promise<void> {
		if (file.extension !== "md") return;

		const path = file.path;
		const newStatus = normalizeStatus(
			cache.frontmatter?.[this.settings.trackedProperty],
		);

		if (this.processing.has(path)) {
			this.trackedValueByPath.set(path, newStatus);
			return;
		}

		const oldStatus = this.trackedValueByPath.get(path) ?? null;
		this.trackedValueByPath.set(path, newStatus);

		if (!newStatus || oldStatus === newStatus) return;

		this.processing.add(path);
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const propertyExists = Object.prototype.hasOwnProperty.call(
					frontmatter,
					newStatus,
				);
				const isFinal = this.settings.finalStatuses.includes(newStatus);

				if (!isFinal || !propertyExists) {
					frontmatter[newStatus] = localDate();
				}
			});
		} finally {
			this.processing.delete(path);
		}
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;

		const status = this.trackedValueByPath.get(oldPath);
		this.trackedValueByPath.delete(oldPath);
		if (status !== undefined) this.trackedValueByPath.set(file.path, status);
	}

	private handleDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.trackedValueByPath.delete(file.path);
		this.processing.delete(file.path);
	}
}

class StatusDatesSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly statusDatesPlugin: StatusDatesPlugin) {
		super(app, statusDatesPlugin);
	}

	display(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			.setName("Tracked property")
			.setDesc("Property whose value changes should be dated.")
			.addText((text) =>
				text
					.setPlaceholder("status")
					.setValue(this.statusDatesPlugin.settings.trackedProperty)
					.onChange(async (value) => {
						this.statusDatesPlugin.settings.trackedProperty =
							value.trim() || DEFAULT_SETTINGS.trackedProperty;
						this.statusDatesPlugin.initializeTrackedValueCache();
						await this.statusDatesPlugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Final statuses")
			.setDesc(
				"Comma-separated statuses whose first recorded date must never be overwritten. Leave empty to overwrite every status date.",
			)
			.addText((text) =>
				text
					.setPlaceholder("published, rejected")
					.setValue(this.statusDatesPlugin.settings.finalStatuses.join(", "))
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
