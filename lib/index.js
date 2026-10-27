// dsh-snowluma-autostart
// DSH 启动时自动拉起本机 SnowLuma（OneBot v11 后端）。
//
// 为什么用插件而不是计划任务：
//   SnowLuma 需要 hook 本地 QQ 进程（中等完整性）。由 DSH 主进程派生，
//   子进程继承 DSH 自己的令牌，天然是中等完整性；同时随 DSH 一起退出，
//   不会留下孤儿进程。

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, openSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'snowluma-autostart'

// 可由 profile 的 cordis.patch.yml 覆盖
const DEFAULTS = {
  appDir: 'C:/Users/jellyStone/Documents/deepseek-harness/default-workspace/snowluma/app',
  webuiPort: 5099,
  onebotHttpPort: 3000,
  delayMs: 1500,
}

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIAG = join(HOME, 'snowluma-autostart.log')

function diag(line) {
  try {
    mkdirSync(HOME, { recursive: true })
    writeFileSync(DIAG, new Date().toISOString() + '  ' + line + '\n', { flag: 'a' })
  } catch {
    /* 诊断失败不影响主流程 */
  }
}

function portUp(port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* ignore */ }
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  const nodeExe = join(cfg.appDir, 'node.exe')
  const entry = join(cfg.appDir, 'index.mjs')

  const start = async () => {
    if (!existsSync(nodeExe) || !existsSync(entry)) {
      diag(`跳过：找不到 ${nodeExe} 或 ${entry}`)
      return
    }
    if (await portUp(cfg.webuiPort)) {
      diag(`跳过：${cfg.webuiPort} 已在监听，说明 SnowLuma 已在运行`)
      return
    }

    let out = 'ignore'
    try {
      out = openSync(join(cfg.appDir, 'sl-out.log'), 'a')
    } catch {
      /* 拿不到日志句柄就丢弃输出 */
    }

    try {
      const child = spawn(nodeExe, [entry], {
        cwd: cfg.appDir,
        // 不开 detached：detached 会给控制台程序另起一个控制台窗口，
        // windowsHide 在那种组合下不生效。不开 detached 时 CREATE_NO_WINDOW 才管用。
        windowsHide: true,
        stdio: ['ignore', out, out],
        env: {
          ...process.env,
          SNOWLUMA_WEBUI_PORT: String(cfg.webuiPort),
          SNOWLUMA_ONEBOT_HTTP_PORT: String(cfg.onebotHttpPort),
          SNOWLUMA_LOG_LEVEL: 'info',
        },
      })
      child.unref()
      diag(`已拉起 SnowLuma pid=${child.pid} webui=${cfg.webuiPort}`)
    } catch (error) {
      diag(`启动失败：${error && error.message ? error.message : String(error)}`)
    }
  }

  const timer = setTimeout(() => {
    start().catch((error) => diag(`异常：${error && error.message ? error.message : String(error)}`))
  }, Math.max(0, Number(cfg.delayMs) || 0))
  if (timer.unref) timer.unref()

  diag('插件已加载 v2（隐藏窗口，无 detached），等待启动 SnowLuma')
}
