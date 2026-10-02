package main

import (
	"strings"
	"unicode/utf8"
)

const max_component_bytes = 255

func is_windows_reserved(stem string) bool {
	upper := strings.ToUpper(strings.TrimRight(stem, " "))
	switch upper {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(upper) == 4 && (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) {
		return upper[3] >= '1' && upper[3] <= '9'
	}
	return false
}

func truncate_component(name string) string {
	if len(name) <= max_component_bytes {
		return name
	}
	ext := ""
	if i := strings.LastIndexByte(name, '.'); i > 0 && len(name)-i <= 20 {
		ext = name[i:]
	}
	limit := max_component_bytes - len(ext)
	for limit > 0 && !utf8.RuneStart(name[limit]) {
		limit--
	}
	return name[:limit] + ext
}

func sanitize_component(name string, windows bool) string {
	if name == "." || name == ".." {
		return name
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r < 0x20 || r == 0x7f || r == utf8.RuneError:
			b.WriteRune('_')
		case windows && strings.ContainsRune(`<>:"/\|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if windows {
		out = strings.TrimRight(out, " .")
	}
	if out == "" {
		return "_"
	}
	if windows {
		stem := out
		if i := strings.IndexByte(out, '.'); i >= 0 {
			stem = out[:i]
		}
		if is_windows_reserved(stem) {
			out = "_" + out
		}
	}
	return truncate_component(out)
}

func sanitize_relative_path(path string, windows bool) string {
	if path == "" {
		return ""
	}
	parts := strings.Split(path, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		out = append(out, sanitize_component(part, windows))
	}
	return strings.Join(out, "/")
}