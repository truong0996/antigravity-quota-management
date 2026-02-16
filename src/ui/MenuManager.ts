import * as vscode from 'vscode';
import { QuotaService } from '../services/QuotaService';

export class MenuManager {
    constructor(private quotaService: QuotaService) { }

    public async showMenu() {
        const models = this.quotaService.getModels();
        const items: (vscode.QuickPickItem & { action?: () => void })[] = [
            {
                label: "$(refresh) Refresh Quotas",
                description: this.quotaService.getRefreshStatus(),
                action: () => vscode.commands.executeCommand('antigravity-quotas.refresh')
            },
            {
                label: "$(edit) Set Nickname for Model",
                action: () => vscode.commands.executeCommand('antigravity-quotas.setNickname')
            },
            { label: "", kind: vscode.QuickPickItemKind.Separator }
        ];

        const nicknames = vscode.workspace.getConfiguration('antigravityQuotas').get<any>('modelNicknames', {});

        models.forEach((m: any) => {
            const perc = Math.round((m.quotaInfo?.remainingFraction ?? 1) * 100);
            const nickname = nicknames[m.label];
            const label = nickname ? `${nickname} (${m.label})` : m.label;

            let resetInfo = "";
            if (m.quotaInfo?.resetTime) {
                resetInfo = ` • Resets in ${this.quotaService.formatRelativeTime(m.quotaInfo.resetTime)}`;
            }

            items.push({
                label: `${perc}% - ${label}`,
                description: resetInfo,
                detail: m.label,
                action: async () => {
                    await this.promptForNickname(m.label, nicknames[m.label]);
                }
            });
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Antigravity Quotas'
        });

        if (selected && selected.action) {
            selected.action();
        }
    }

    public async promptForNickname(modelName: string, currentNickname: string = "") {
        const nick = await vscode.window.showInputBox({
            placeHolder: 'Enter nickname (leave empty to reset)',
            prompt: `Nickname for ${modelName}`,
            value: currentNickname
        });

        if (nick !== undefined) {
            const config = vscode.workspace.getConfiguration('antigravityQuotas');
            const nicks: any = { ...config.get('modelNicknames', {}) };
            if (nick === '') {
                delete nicks[modelName];
            } else {
                nicks[modelName] = nick;
            }
            await config.update('modelNicknames', nicks, vscode.ConfigurationTarget.Global);
            // Updating config triggers QuotaService to update, which triggers StatusBarManager
        }
    }

    public async showNicknamePicker() {
        const models = this.quotaService.getModels();
        if (models.length === 0) {
            vscode.window.showWarningMessage("No models found.");
            return;
        }
        const modelPick = await vscode.window.showQuickPick(models.map((m: any) => m.label), {
            placeHolder: 'Select model to set nickname for'
        });

        if (modelPick) {
            const nicknames = vscode.workspace.getConfiguration('antigravityQuotas').get<any>('modelNicknames', {});
            await this.promptForNickname(modelPick, nicknames[modelPick]);
        }
    }
}
