package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func resume_key(sender_fp string, transfer_id string, manifest []approved_file) (string, error) {
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(sender_fp + "\x00" + transfer_id + "\x00" + string(encoded)))
	return hex.EncodeToString(sum[:]), nil
}

func (s *server_state) resume_session_path(key string) string {
	return filepath.Join(s.user_data_dir, "transfer-parts", key+".json")
}

func (s *server_state) resume_part_path(session transfer_resume_session, key string, index int) string {
	name := fmt.Sprintf(".lanshare-%s-%d.part", key, index)
	return filepath.Join(filepath.Dir(session.TargetPaths[index]), name)
}

func (s *server_state) write_resume_session(key string, session transfer_resume_session) error {
	session_path := s.resume_session_path(key)
	if err := os.MkdirAll(filepath.Dir(session_path), 0o700); err != nil {
		return fmt.Errorf("unable to create transfer resume folder: %w", err)
	}
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(session_path), key+"-*.tmp")
	if err != nil {
		return fmt.Errorf("unable to save transfer resume state: %w", err)
	}
	temp_path := temp.Name()
	defer os.Remove(temp_path)
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return fmt.Errorf("unable to save transfer resume state: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("unable to save transfer resume state: %w", err)
	}
	if err := os.Rename(temp_path, session_path); err != nil {
		return fmt.Errorf("unable to save transfer resume state: %w", err)
	}
	return nil
}

func (s *server_state) read_resume_session(key string) (transfer_resume_session, error) {
	data, err := os.ReadFile(s.resume_session_path(key))
	if err != nil {
		return transfer_resume_session{}, err
	}
	var session transfer_resume_session
	if err := json.Unmarshal(data, &session); err != nil {
		return transfer_resume_session{}, fmt.Errorf("invalid saved transfer resume state: %w", err)
	}
	return session, nil
}

func (s *server_state) prepare_resume_session(
	transfer_id string,
	peer_id string,
	sender_fp string,
	manifest []approved_file,
	download_folder string,
) (string, transfer_resume_session, []int64, error) {
	key, err := resume_key(sender_fp, transfer_id, manifest)
	if err != nil {
		return "", transfer_resume_session{}, nil, err
	}
	s.resume_mu.Lock()
	defer s.resume_mu.Unlock()
	if _, active := s.active_resumes[key]; active {
		return "", transfer_resume_session{}, nil, errors.New("this transfer is already receiving")
	}

	session, err := s.read_resume_session(key)
	if err == nil {
		if session.TransferID != transfer_id || session.PeerID != peer_id || !manifest_matches(session.Manifest, manifest) || len(session.TargetPaths) != len(manifest) {
			return "", transfer_resume_session{}, nil, errors.New("saved transfer resume state does not match this transfer")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", transfer_resume_session{}, nil, err
	} else {
		if err := os.MkdirAll(download_folder, 0o755); err != nil {
			return "", transfer_resume_session{}, nil, fmt.Errorf("unable to prepare download folder: %w", err)
		}
		session, err = new_transfer_resume_session(transfer_id, peer_id, manifest, download_folder)
		if err != nil {
			return "", transfer_resume_session{}, nil, err
		}
		if err := s.write_resume_session(key, session); err != nil {
			return "", transfer_resume_session{}, nil, err
		}
	}

	offsets, err := s.resume_offsets(key, session, manifest)
	if err != nil {
		return "", transfer_resume_session{}, nil, err
	}
	return key, session, offsets, nil
}

func new_transfer_resume_session(
	transfer_id string,
	peer_id string,
	manifest []approved_file,
	download_folder string,
) (transfer_resume_session, error) {
	session := transfer_resume_session{
		TransferID:     transfer_id,
		PeerID:         peer_id,
		Manifest:       append([]approved_file(nil), manifest...),
		DownloadFolder: download_folder,
		TargetPaths:    make([]string, len(manifest)),
	}
	allocated := make(map[string]struct{}, len(manifest))
	for index, file := range manifest {
		target, err := safe_download_path(download_folder, sanitize_relative_path(file.RelativePath, runtime.GOOS == "windows"))
		if err != nil {
			return transfer_resume_session{}, fmt.Errorf("unsafe transfer path: %w", err)
		}
		session.TargetPaths[index] = target
		if file.IsDir {
			allocated[resume_target_key(target)] = struct{}{}
		}
	}
	for index, file := range manifest {
		if file.IsDir {
			continue
		}
		base_target := session.TargetPaths[index]
		target := base_target
		for suffix := 0; ; suffix++ {
			if suffix > 0 {
				extension := filepath.Ext(base_target)
				base_name := strings.TrimSuffix(filepath.Base(base_target), extension)
				target = filepath.Join(
					filepath.Dir(base_target),
					fmt.Sprintf("%s (%d)%s", base_name, suffix, extension),
				)
			}
			if _, exists := allocated[resume_target_key(target)]; exists {
				continue
			}
			if _, err := os.Lstat(target); err == nil {
				continue
			} else if !errors.Is(err, os.ErrNotExist) {
				return transfer_resume_session{}, fmt.Errorf("unable to inspect destination path: %w", err)
			}
			allocated[resume_target_key(target)] = struct{}{}
			session.TargetPaths[index] = target
			break
		}
	}
	return session, nil
}

func resume_target_key(target string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(target)
	}
	return target
}

func (s *server_state) resume_offsets(
	key string,
	session transfer_resume_session,
	manifest []approved_file,
) ([]int64, error) {
	offsets := make([]int64, len(manifest))
	for index, file := range manifest {
		part_path := s.resume_part_path(session, key, index)
		info, err := os.Lstat(part_path)
		if errors.Is(err, os.ErrNotExist) || file.IsDir {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("unable to inspect partial transfer file: %w", err)
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("partial transfer path is not a regular file")
		}
		if info.Size() > file.Size {
			if err := os.Remove(part_path); err != nil {
				return nil, fmt.Errorf("unable to reset invalid partial transfer file: %w", err)
			}
			continue
		}
		offsets[index] = info.Size()
	}
	return offsets, nil
}

func (s *server_state) begin_resume(key string, transfer_id string, peer_id string, manifest []approved_file) (transfer_resume_session, bool, error) {
	s.resume_mu.Lock()
	defer s.resume_mu.Unlock()
	if _, active := s.active_resumes[key]; active {
		return transfer_resume_session{}, false, errors.New("this transfer is already receiving")
	}
	session, err := s.read_resume_session(key)
	if err != nil {
		return transfer_resume_session{}, false, err
	}
	if session.TransferID != transfer_id || session.PeerID != peer_id || !manifest_matches(session.Manifest, manifest) || len(session.TargetPaths) != len(manifest) {
		return transfer_resume_session{}, false, errors.New("saved transfer resume state does not match this transfer")
	}
	s.active_resumes[key] = struct{}{}
	return session, true, nil
}

func (s *server_state) end_resume(key string) {
	s.resume_mu.Lock()
	delete(s.active_resumes, key)
	s.resume_mu.Unlock()
}

func (s *server_state) save_resume_session(key string, session transfer_resume_session) error {
	s.resume_mu.Lock()
	defer s.resume_mu.Unlock()
	return s.write_resume_session(key, session)
}

func (s *server_state) finish_resume_session(key string, session transfer_resume_session) {
	s.resume_mu.Lock()
	defer s.resume_mu.Unlock()
	for index := range session.Manifest {
		if session.Manifest[index].IsDir {
			continue
		}
		part_path := s.resume_part_path(session, key, index)
		if err := os.Remove(part_path); err != nil && !errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(os.Stderr, "failed to remove completed transfer part %q: %v\n", part_path, err)
		}
	}
	if err := os.Remove(s.resume_session_path(key)); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(os.Stderr, "failed to remove completed transfer state: %v\n", err)
	}
}

func validate_resume_target(download_folder string, target string) error {
	base, err := filepath.Abs(download_folder)
	if err != nil {
		return err
	}
	absolute_target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(base, absolute_target)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("saved transfer target escapes the download folder")
	}
	return ensure_no_symlink_escape(base, absolute_target)
}

func (s *server_state) finalize_resume_session(key string, session *transfer_resume_session) error {
	type moved_part struct {
		target string
		part   string
	}
	var moved []moved_part
	rollback := func() {
		for index := len(moved) - 1; index >= 0; index-- {
			if err := os.Rename(moved[index].target, moved[index].part); err != nil {
				fmt.Fprintf(os.Stderr, "failed to restore completed transfer part %q: %v\n", moved[index].target, err)
			}
		}
	}
	for index, file := range session.Manifest {
		target := session.TargetPaths[index]
		if err := validate_resume_target(session.DownloadFolder, target); err != nil {
			rollback()
			return err
		}
		if file.IsDir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				rollback()
				return fmt.Errorf("unable to create received folder: %w", err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			rollback()
			return fmt.Errorf("unable to create parent folder: %w", err)
		}
		part_path := s.resume_part_path(*session, key, index)
		if _, err := os.Lstat(target); err == nil {
			target = get_unique_file_path(target)
			session.TargetPaths[index] = target
			if err := s.save_resume_session(key, *session); err != nil {
				rollback()
				return err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			rollback()
			return fmt.Errorf("unable to inspect destination file: %w", err)
		}
		if err := validate_resume_target(session.DownloadFolder, target); err != nil {
			rollback()
			return err
		}
		if err := os.Rename(part_path, target); err != nil {
			rollback()
			return fmt.Errorf("unable to finalize received file: %w", err)
		}
		moved = append(moved, moved_part{target: target, part: part_path})
	}
	return nil
}
