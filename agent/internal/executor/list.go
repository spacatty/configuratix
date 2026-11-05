package executor

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// listRoots are the only trees the `list` action may inspect.
var listRoots = []string{"/etc/nginx", "/etc/php", "/etc/ssh", "/etc/letsencrypt/live", "/var/www"}

// namesOnlyRoots never expose size/hash/link targets (private keys live there).
var namesOnlyRoots = map[string]bool{"/etc/letsencrypt/live": true}

const (
	listMaxEntries  = 5000
	listMaxHashSize = 16 << 20
)

type ListEntry struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Type       string `json:"type"` // file, dir, symlink, other
	Size       *int64 `json:"size,omitempty"`
	Mode       string `json:"mode,omitempty"`
	MTime      string `json:"mtime"`
	SHA256     string `json:"sha256,omitempty"`
	LinkTarget string `json:"link_target,omitempty"`
}

type ListResult struct {
	Pattern   string      `json:"pattern"`
	Root      string      `json:"root"`
	Entries   []ListEntry `json:"entries"`
	Truncated bool        `json:"truncated"`
}

// listRootFor validates a pattern and returns the allowlisted root it lives in.
// Validation uses forward-slash path semantics regardless of host OS.
func listRootFor(pattern string) (string, string, error) {
	if pattern == "" || !strings.HasPrefix(pattern, "/") {
		return "", "", fmt.Errorf("list: path must be absolute")
	}
	clean := path.Clean(pattern)
	for _, root := range listRoots {
		if clean == root || strings.HasPrefix(clean, root+"/") {
			return root, clean, nil
		}
	}
	return "", "", fmt.Errorf("list: %s is outside the allowed roots (%s)", pattern, strings.Join(listRoots, ", "))
}

func withinRoot(p, root string) bool {
	p = path.Clean(filepath.ToSlash(p))
	return p == root || strings.HasPrefix(p, root+"/")
}

func listFiles(pattern string, recursive, hash bool) (*ListResult, error) {
	root, clean, err := listRootFor(pattern)
	if err != nil {
		return nil, err
	}
	matches, err := filepath.Glob(filepath.FromSlash(clean))
	if err != nil {
		return nil, fmt.Errorf("list: bad pattern: %v", err)
	}
	sort.Strings(matches)

	res := &ListResult{Pattern: clean, Root: root, Entries: []ListEntry{}}
	namesOnly := namesOnlyRoots[root]
	seen := map[string]bool{}

	add := func(p string) bool {
		if len(res.Entries) >= listMaxEntries {
			res.Truncated = true
			return false
		}
		if seen[p] || !withinRoot(p, root) {
			return true
		}
		seen[p] = true
		if e, ok := describe(p, root, namesOnly, hash); ok {
			res.Entries = append(res.Entries, e)
		}
		return true
	}

	for _, m := range matches {
		if !add(m) {
			break
		}
		if !recursive {
			continue
		}
		fi, err := os.Lstat(m)
		if err != nil || !fi.IsDir() {
			continue
		}
		stop := false
		_ = filepath.WalkDir(m, func(p string, d fs.DirEntry, err error) error {
			if err != nil || p == m {
				return nil
			}
			if !add(p) {
				stop = true
				return filepath.SkipAll
			}
			return nil
		})
		if stop {
			break
		}
	}
	return res, nil
}

func describe(p, root string, namesOnly, hash bool) (ListEntry, bool) {
	fi, err := os.Lstat(p)
	if err != nil {
		return ListEntry{}, false
	}
	e := ListEntry{
		Path:  filepath.ToSlash(p),
		Name:  fi.Name(),
		MTime: fi.ModTime().UTC().Format(time.RFC3339),
	}
	switch {
	case fi.Mode()&os.ModeSymlink != 0:
		e.Type = "symlink"
	case fi.IsDir():
		e.Type = "dir"
	case fi.Mode().IsRegular():
		e.Type = "file"
	default:
		e.Type = "other"
	}
	if namesOnly {
		return e, true
	}
	e.Mode = fmt.Sprintf("%04o", fi.Mode().Perm())

	if e.Type == "symlink" {
		if t, err := os.Readlink(p); err == nil {
			e.LinkTarget = t
		}
		// Only follow links that resolve inside an allowlisted root.
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil {
			return e, true
		}
		if !withinAllowedContentRoot(resolved) {
			return e, true
		}
		if tfi, err := os.Stat(resolved); err == nil && tfi.Mode().IsRegular() {
			sz := tfi.Size()
			e.Size = &sz
			if hash && sz <= listMaxHashSize {
				e.SHA256 = sha256File(resolved)
			}
		}
		return e, true
	}
	if e.Type == "file" {
		// A parent directory may be a symlink pointing outside the roots.
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil || !withinAllowedContentRoot(resolved) {
			return e, true
		}
		sz := fi.Size()
		e.Size = &sz
		if hash && sz <= listMaxHashSize {
			e.SHA256 = sha256File(p)
		}
	}
	return e, true
}

func withinAllowedContentRoot(p string) bool {
	for _, r := range listRoots {
		if withinRoot(p, r) && !namesOnlyRoots[r] {
			return true
		}
	}
	return false
}

func sha256File(p string) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}
