import * as vscode from 'vscode';
import { QuotaService } from '../services/QuotaService';

export class StatusBarManager {
    private items: Map<string, vscode.StatusBarItem> = new Map();

    constructor(private quotaService: QuotaService, private context: vscode.ExtensionContext) {
        // Update on service events
        this.quotaService.onDidUpdate(() => this.update());
        // Update on config changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityQuotas')) {
                this.update();
            }
        });
    }

    public update() {
        const config = vscode.workspace.getConfiguration('antigravityQuotas');
        const groups = config.get<any[]>('groups', []);
        const models = this.quotaService.getModels();

        // Cleanup unused items
        const currentGroupNames = new Set(groups.map(g => g.name));
        for (const name of this.items.keys()) {
            if (!currentGroupNames.has(name) && name !== "__off__") {
                this.items.get(name)?.dispose();
                this.items.delete(name);
            }
        }

        if (models.length === 0) {
            // Show a single "off" indicator if no groups can be formed
            if (this.items.size === 0) {
                const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
                item.text = "$(error) Server Off";
                item.show();
                this.items.set("__off__", item);
                this.context.subscriptions.push(item);
            }
            return;
        } else {
            this.items.get("__off__")?.dispose();
            this.items.delete("__off__");
        }

        groups.forEach((group, index) => {
            const name = group.name;
            const patterns = group.patterns || [];

            let item = this.items.get(name);
            if (!item) {
                // Priority 100 is the standard for right-aligned items.
                item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100 - index);
                item.command = 'antigravity-quotas.show';
                item.show();
                this.items.set(name, item);
                this.context.subscriptions.push(item);
            }

            const matchingModels = models.filter((m: any) =>
                patterns.some((p: string) => m.label.toLowerCase().includes(p.toLowerCase()))
            );

            if (matchingModels.length > 0) {
                // Find model with the minimum remaining fraction
                const worstModel = matchingModels.reduce((prev: any, curr: any) =>
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
                    resetStr = `\nResets in: ${this.quotaService.formatRelativeTime(worstModel.quotaInfo.resetTime)} (${absTime})`;
                }
                item.tooltip = `Group: ${name}\nModels: ${matchingModels.map((m: any) => m.label).join(", ")}${resetStr}`;
            } else {
                item.text = `$(warning) ${name}: ?`;
                item.color = new vscode.ThemeColor('disabledForeground');
                item.tooltip = `No models matched patterns: ${patterns.join(", ")}`;
            }
        });
    }

    public dispose() {
        this.items.forEach(i => i.dispose());
        this.items.clear();
    }
}
