import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const REFRESH_INTERVAL_MS = 30 * 1000;
const FAST_TIMER_MS = 1000;

let log: vscode.OutputChannel;
let statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
let quotaProvider: QuotaProvider;

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Antigravity Quotas");
    log.appendLine("Extension activated.");

    quotaProvider = new QuotaProvider();

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.refresh', () => {
        log.appendLine("Manual refresh requested.");
        quotaProvider.manualRefresh();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.show', async () => {
        log.appendLine("Show quotas menu command executed.");

        const models = quotaProvider.getModels();
        const items: (vscode.QuickPickItem & { action?: () => void })[] = [
            {
                label: "$(refresh) Refresh Quotas",
                description: quotaProvider.getRefreshStatus(),
                action: () => vscode.commands.executeCommand('antigravity-quotas.refresh')
            },
            {
                label: "$(edit) Set Nickname for Model",
                action: () => vscode.commands.executeCommand('antigravity-quotas.setNickname')
            },
            { label: "", kind: vscode.QuickPickItemKind.Separator }
        ];

        const nicknames = vscode.workspace.getConfiguration('antigravityQuotas').get<any>('modelNicknames', {});

        models.forEach(m => {
            const perc = Math.round((m.quotaInfo?.remainingFraction ?? 1) * 100);
            const nickname = nicknames[m.label];
            const label = nickname ? `${nickname} (${m.label})` : m.label;

            let resetInfo = "";
            if (m.quotaInfo?.resetTime) {
                resetInfo = ` • Resets in ${quotaProvider.formatRelativeTime(m.quotaInfo.resetTime)}`;
            }

            items.push({
                label: `${perc}% - ${label}`,
                description: resetInfo,
                detail: m.label,
                action: async () => {
                    const nick = await vscode.window.showInputBox({
                        placeHolder: 'Enter nickname (leave empty to reset)',
                        prompt: `Nickname for ${m.label}`,
                        value: nicknames[m.label] || ""
                    });
                    if (nick !== undefined) {
                        const config = vscode.workspace.getConfiguration('antigravityQuotas');
                        const nicks: any = { ...config.get('modelNicknames', {}) };
                        if (nick === '') {
                            delete nicks[m.label];
                        } else {
                            nicks[m.label] = nick;
                        }
                        await config.update('modelNicknames', nicks, vscode.ConfigurationTarget.Global);
                        quotaProvider.updateStatusBar();
                    }
                }
            });
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Antigravity Quotas'
        });

        if (selected && selected.action) {
            selected.action();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.setNickname', async () => {
        const models = quotaProvider.getModels();
        if (models.length === 0) {
            vscode.window.showWarningMessage("No models found.");
            return;
        }
        const modelPick = await vscode.window.showQuickPick(models.map(m => m.label), {
            placeHolder: 'Select model to set nickname for'
        });
        if (modelPick) {
            const nick = await vscode.window.showInputBox({
                placeHolder: 'Enter nickname (leave empty to reset)',
                prompt: `Nickname for ${modelPick}`,
                value: vscode.workspace.getConfiguration('antigravityQuotas').get<any>('modelNicknames', {})[modelPick] || ""
            });
            if (nick !== undefined) {
                const config = vscode.workspace.getConfiguration('antigravityQuotas');
                const nicknames: any = { ...config.get('modelNicknames', {}) };
                if (nick === '') {
                    delete nicknames[modelPick];
                } else {
                    nicknames[modelPick] = nick;
                }
                await config.update('modelNicknames', nicknames, vscode.ConfigurationTarget.Global);
                quotaProvider.updateStatusBar();
            }
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravityQuotas')) {
            quotaProvider.updateStatusBar();
        }
    }));

    context.subscriptions.push(log);
}

class QuotaProvider {
    private nextFetchTime = Date.now();
    private cachedModels: any[] = [];
    private isRefreshing = false;
    private lastError: string | undefined;

    constructor() {
        setInterval(() => {
            if (Date.now() >= this.nextFetchTime && !this.isRefreshing) {
                this.refresh();
            }
            this.updateStatusBar();
        }, FAST_TIMER_MS);
    }

    getModels() { return this.cachedModels; }

    getRefreshStatus(): string {
        if (this.isRefreshing) return "Refreshing...";
        const secondsLeft = Math.max(0, Math.floor((this.nextFetchTime - Date.now()) / 1000));
        return `Next check in: ${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`;
    }

    async manualRefresh() {
        this.nextFetchTime = Date.now();
        await this.refresh();
    }

    async refresh() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        try {
            log.appendLine(`Fetching quotas at ${new Date().toLocaleTimeString()}...`);
            this.cachedModels = await this.fetchQuotas();
            this.lastError = this.cachedModels.length === 0 ? "Model server not found or not responding." : undefined;
            this.nextFetchTime = Date.now() + REFRESH_INTERVAL_MS;
            log.appendLine(`Fetch complete. Found ${this.cachedModels.length} models.`);
        } catch (e: any) {
            log.appendLine(`Fetch failed: ${e.message}`);
            this.lastError = `Error: ${e.message}`;
            this.cachedModels = [];
            this.nextFetchTime = Date.now() + 30000;
        } finally {
            this.isRefreshing = false;
            this.updateStatusBar();
        }
    }

    public updateStatusBar() {
        const config = vscode.workspace.getConfiguration('antigravityQuotas');
        const groups = config.get<any[]>('groups', []);

        // Cleanup unused items
        const currentGroupNames = new Set(groups.map(g => g.name));
        for (const name of statusBarItems.keys()) {
            if (!currentGroupNames.has(name)) {
                statusBarItems.get(name)?.dispose();
                statusBarItems.delete(name);
            }
        }

        if (this.cachedModels.length === 0) {
            // Show a single "off" indicator if no groups can be formed
            if (statusBarItems.size === 0) {
                const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
                item.text = "$(error) Server Off";
                item.show();
                statusBarItems.set("__off__", item);
            }
            return;
        } else {
            statusBarItems.get("__off__")?.dispose();
            statusBarItems.delete("__off__");
        }

        groups.forEach((group, index) => {
            const name = group.name;
            const patterns = group.patterns || [];

            let item = statusBarItems.get(name);
            if (!item) {
                // Priority 100 is the standard for right-aligned items.
                // This should place it to the left of lower-priority items like the settings/notification bell.
                item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100 - index);
                item.command = 'antigravity-quotas.show';
                item.show();
                statusBarItems.set(name, item);
            }

            const matchingModels = this.cachedModels.filter(m =>
                patterns.some((p: string) => m.label.toLowerCase().includes(p.toLowerCase()))
            );

            if (matchingModels.length > 0) {
                // Find model with the minimum remaining fraction
                const worstModel = matchingModels.reduce((prev, curr) =>
                    (curr.quotaInfo?.remainingFraction ?? 1) < (prev.quotaInfo?.remainingFraction ?? 1) ? curr : prev
                );

                const minFrac = worstModel.quotaInfo?.remainingFraction ?? 1;
                const perc = Math.round(minFrac * 100);

                let icon = "$(circle-filled)";
                let color: vscode.ThemeColor | undefined;

                if (perc >= 40) {
                    color = new vscode.ThemeColor('charts.green');
                } else if (perc >= 20) {
                    color = new vscode.ThemeColor('charts.yellow');
                } else {
                    color = new vscode.ThemeColor('charts.red');
                }

                item.text = `${icon} ${name}: ${perc}%`;
                item.color = color;

                let resetStr = "";
                if (worstModel.quotaInfo?.resetTime) {
                    const absTime = new Date(worstModel.quotaInfo.resetTime).toLocaleString();
                    resetStr = `\nResets in: ${this.formatRelativeTime(worstModel.quotaInfo.resetTime)} (${absTime})`;
                }
                item.tooltip = `Group: ${name}\nModels: ${matchingModels.map(m => m.label).join(", ")}${resetStr}`;
            } else {
                item.text = `$(warning) ${name}: ?`;
                item.color = new vscode.ThemeColor('disabledForeground');
                item.tooltip = `No models matched patterns: ${patterns.join(", ")}`;
            }
        });
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

    private async fetchQuotas(): Promise<any[]> {
        const isWindows = process.platform === 'win32';
        try {
            let pid = "";
            let csrf = "";

            if (isWindows) {
                const { stdout: tasklistOut } = await execAsync('tasklist /FO CSV /NH');
                const lines = tasklistOut.split('\n');
                let foundImageName = "";
                for (const line of lines) {
                    if (line.includes("language_server")) {
                        foundImageName = line.split(',')[0].replace(/"/g, '');
                        break;
                    }
                }

                if (!foundImageName) return [];

                const { stdout: taskOut } = await execAsync(`wmic process where "name='${foundImageName}'" get commandline,processid /format:list`);
                pid = (taskOut.match(/ProcessId=(\d+)/))?.[1] || "";
                csrf = (taskOut.match(/--csrf_token\s+([^\s]+)/) || taskOut.match(/--csrf_token=([^\s]+)/))?.[1] || "";
            } else {
                const { stdout: psOut } = await execAsync("ps aux | grep language_server | grep -v grep");
                const line = psOut.split('\n')[0];
                pid = line.trim().split(/\s+/)[1];
                csrf = (line.match(/--csrf_token\s+([^\s]+)/) || line.match(/--csrf_token=([^\s]+)/))?.[1] || "";
            }

            if (!pid) return [];

            let ports: string[] = [];
            if (isWindows) {
                const { stdout: netstatOut } = await execAsync(`netstat -ano -p tcp`);
                const lines = netstatOut.split('\n');
                for (const line of lines) {
                    if (line.includes('LISTENING') && line.includes(pid)) {
                        const portMatch = line.match(/:(\d+)\s+/);
                        if (portMatch) ports.push(portMatch[1]);
                    }
                }
            } else {
                const { stdout: lsofOut } = await execAsync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`);
                ports = [...new Set(lsofOut.match(/:(\d+)\s+\(LISTEN\)/g)?.map(p => p.match(/:(\d+)/)![1]))];
            }

            for (const port of ports) {
                try {
                    const res = await fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
                        method: 'POST', headers: { 'X-Codeium-Csrf-Token': csrf, 'Connect-Protocol-Version': '1', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } })
                    });
                    if (res.ok) {
                        const data = (await res.json()) as any;
                        return data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
                    }
                } catch (e: any) { }
            }
        } catch (e: any) { throw e; }
        return [];
    }
}
