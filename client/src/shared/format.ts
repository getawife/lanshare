export function format_bytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const text =
    index === 0
      ? String(Math.round(value))
      : value.toFixed(value >= 100 ? 0 : 1);
  return `${text} ${units[index]}`;
}

export function format_speed(bytes_per_second: number): string {
  return `${format_bytes(bytes_per_second)}/s`;
}

export function format_fingerprint(fingerprint: string | undefined): string {
  const hex = (fingerprint ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length < 20) return "";
  return hex.slice(0, 20).match(/.{4}/g)?.join(" ") ?? "";
}
