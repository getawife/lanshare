//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func free_disk_bytes(path string) (uint64, error) {
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")
	ptr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var free, total, total_free uint64
	ret, _, call_err := proc.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&free)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&total_free)),
	)
	if ret == 0 {
		return 0, call_err
	}
	return free, nil
}
