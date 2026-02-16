import * as vscode from 'vscode';
import { ProcessFinder } from './ProcessFinder';

export class QuotaService {
    private cachedModels: any[] = [];
    private processFinder: ProcessFinder;
    private refreshInterval: number = 30000;
    private lowQuotaThreshold: number = 20;
    private nextFetchTime = Date.now();
    private isRefreshing = false;
    private lastError: string | undefined;
    private notifiedGroups: Set<string> = new Set();

    private _onDidUpdate = new vscode.EventEmitter<void>();
    public readonly onDidUpdate = this._onDidUpdate.event;

    constructor(private log: vscode.OutputChannel) {
        this.processFinder = new ProcessFinder();
        this.updateConfig();

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityQuotas')) {
                this.updateConfig();
            }
        });

        // Start polling loop
        setInterval(() => this.poll(), 1000);
    }

    private updateConfig() {
        const config = vscode.workspace.getConfiguration('antigravityQuotas');
        this.refreshInterval = (config.get<number>('refreshInterval', 30)) * 1000;
        this.lowQuotaThreshold = config.get<number>('lowQuotaThreshold', 20);
    }

    private async poll() {
        if (Date.now() >= this.nextFetchTime && !this.isRefreshing) {
            await this.refresh();
        } else {
            // Emit update for timer countdowns even if not fetching
            this._onDidUpdate.fire();
        }
    }

    public getModels() { return this.cachedModels; }

    public getRefreshStatus(): string {
        if (this.isRefreshing) return "Refreshing...";
        const secondsLeft = Math.max(0, Math.floor((this.nextFetchTime - Date.now()) / 1000));
        return `Next check in: ${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`;
    }

    public formatRelativeTime(isoString: string): string {
        try {
            const resetDate = new Date(isoString);
            const now = new Date();
            const diffMs = resetDate.getTime() - now.getTime();

            if (diffMs <= 0) return "just now / soon";

            const diffSeconds = Math.floor(diffMs / 1000);
            const diffMinutes = Math.floor(diffSeconds / 60);
            const diffHours = Math.floor(diffMinutes / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h`;
            if (diffHours > 0) return `${diffHours}h ${diffMinutes % 60}m`;
            if (diffMinutes > 0) return `${diffMinutes}m ${diffSeconds % 60}s`;
            return `${diffSeconds}s`;
        } catch (e) {
            return "N/A";
        }
    }

    public async refresh() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        this._onDidUpdate.fire();

        try {
            this.log.appendLine(`Fetching quotas at ${new Date().toLocaleTimeString()}...`);

            const processInfo = await this.processFinder.findLanguageServerPorts();
            if (processInfo.length === 0) {
                this.cachedModels = [];
                this.lastError = "Language server not found.";
            } else {
                // Try each port until successful
                let success = false;
                for (const { port, csrf } of processInfo) {
                    try {
                        const res = await fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
                            method: 'POST',
                            headers: {
                                'X-Codeium-Csrf-Token': csrf,
                                'Connect-Protocol-Version': '1',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } })
                        });

                        if (res.ok) {
                            const data = (await res.json()) as any;
                            this.cachedModels = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
                            success = true;
                            break;
                        }
                    } catch (e) { }
                }

                if (!success) {
                    this.lastError = "Failed to connect to language server.";
                    this.cachedModels = [];
                } else {
                    this.lastError = undefined;
                }
            }

            this.checkLowQuota();

            this.nextFetchTime = Date.now() + this.refreshInterval;
            this.log.appendLine(`Fetch complete. Found ${this.cachedModels.length} models.`);

        } catch (e: any) {
            this.log.appendLine(`Fetch failed: ${e.message}`);
            this.lastError = e.message;
            this.nextFetchTime = Date.now() + 30000; // Retry slower on error
        } finally {
            this.isRefreshing = false;
            this._onDidUpdate.fire();
        }
    }

    private checkLowQuota() {
        const config = vscode.workspace.getConfiguration('antigravityQuotas');
        const groups = config.get<any[]>('groups', []);
        const currentNotifiedGroups = new Set<string>();

        // Check each group
        for (const group of groups) {
            const name = group.name;
            const patterns = group.patterns || [];

            // Find models in this group
            const groupModels = this.cachedModels.filter((m: any) =>
                patterns.some((p: string) => m.label.toLowerCase().includes(p.toLowerCase()))
            );

            if (groupModels.length === 0) continue;

            // Find lowest quota in group
            const worstModel = groupModels.reduce((prev: any, curr: any) =>
                (curr.quotaInfo?.remainingFraction ?? 1) < (prev.quotaInfo?.remainingFraction ?? 1) ? curr : prev
            );

            const remaining = (worstModel.quotaInfo?.remainingFraction ?? 1) * 100;

            if (remaining <= this.lowQuotaThreshold) {
                // Determine if we should notify for this group
                if (!this.notifiedGroups.has(name)) {
                    vscode.window.showWarningMessage(
                        `Warning: ${name} quota is low (${Math.round(remaining)}%).`,
                        "Check Quotas"
                    ).then(selection => {
                        if (selection === "Check Quotas") {
                            vscode.commands.executeCommand('antigravity-quotas.show');
                        }
                    });
                    this.notifiedGroups.add(name);
                }
                currentNotifiedGroups.add(name);
            }
        }

        // Reset notification state if quota goes back up for a group
        for (const name of this.notifiedGroups) {
            if (!currentNotifiedGroups.has(name)) {
                this.notifiedGroups.delete(name);
            }
        }
    }
}
