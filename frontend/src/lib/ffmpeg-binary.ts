import { access, chmod, copyFile, constants } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";

let cachedBinary: string | null = null;

function executableName(): string {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function bundledCandidates(): string[] {
  const name = executableName();
  const fromPkg = ffmpegStaticPath?.trim();
  const paths = [
    fromPkg,
    process.env.FFMPEG_BIN?.trim(),
    join(process.cwd(), "node_modules", "ffmpeg-static", name),
  ];
  if (process.platform === "win32" && fromPkg && !fromPkg.endsWith(".exe")) {
    paths.push(`${fromPkg}.exe`);
  }
  return [...new Set(paths.filter((p): p is string => Boolean(p)))];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyToTmp(source: string): Promise<string> {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const dest = join(tmpdir(), `openclu-ffmpeg-${hash}-${executableName()}`);
  if (await pathExists(dest)) {
    return dest;
  }
  await copyFile(source, dest);
  if (process.platform !== "win32") {
    await chmod(dest, 0o755).catch(() => undefined);
  }
  return dest;
}

/**
 * Resolve a runnable ffmpeg binary (ffmpeg-static, env override, or system PATH).
 * On serverless, copies the bundled binary to /tmp when the traced path is not executable.
 */
export async function resolveFfmpegBinary(): Promise<string> {
  if (cachedBinary && (await pathExists(cachedBinary))) {
    return cachedBinary;
  }

  const useTmpCopy =
    process.platform !== "win32" &&
    (process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME);

  for (const candidate of bundledCandidates()) {
    if (!(await pathExists(candidate))) continue;
    if (process.platform === "win32" && !useTmpCopy) {
      cachedBinary = candidate;
      return candidate;
    }
    if (useTmpCopy) {
      cachedBinary = await copyToTmp(candidate);
      return cachedBinary;
    }
    try {
      await access(candidate, constants.X_OK);
      cachedBinary = candidate;
      return candidate;
    } catch {
      cachedBinary = await copyToTmp(candidate);
      return cachedBinary;
    }
  }

  // Last resort: system ffmpeg on PATH (local dev with ffmpeg installed)
  const systemName = executableName();
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync(systemName, ["-version"], { timeout: 5000 });
    cachedBinary = systemName;
    return systemName;
  } catch {
    /* not on PATH */
  }

  throw new Error(
    "ffmpeg binary not found. Reinstall dependencies (npm install in frontend/) and restart the dev server. " +
      "On Vercel, ensure outputFileTracingIncludes bundles node_modules/ffmpeg-static.",
  );
}

export function isFfmpegMissingError(message: string): boolean {
  return /ENOENT|ffmpeg binary not found|spawn.*ffmpeg/i.test(message);
}
