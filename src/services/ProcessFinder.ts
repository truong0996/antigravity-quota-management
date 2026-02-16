import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ProcessFinder {
    public async findLanguageServerPorts(): Promise<{ port: string, csrf: string }[]> {
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
                if (!line) return [];
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

            return ports.map(port => ({ port, csrf }));
        } catch (e) {
            console.error("Error finding process:", e);
            return [];
        }
    }
}
