package ssh

import (
	"testing"
)

func TestParseLsOutput_GNU(t *testing.T) {
	output := `total 48
drwxr-xr-x  5 user group 4096 2026-09-21T12:00:00Z .
drwxr-xr-x 10 user group 4096 2026-09-20T10:00:00Z ..
-rw-r--r--  1 user group 1024 2026-09-21T11:22:33Z app.log
-rwxr-xr-x  1 user group 8192 2026-09-15T08:30:00Z run.sh
drwxr-xr-x  2 user group 4096 2026-09-01T00:00:00Z config
lrwxrwxrwx  1 user group    7 2026-09-21T11:22:33Z app.link -> app.log
-rw-rw-r--  1 user group  500 2026-09-21T11:00:00Z file with spaces.txt
`
	entries := ParseLsOutput(output, "/home/user")
	if len(entries) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(entries))
	}

	// 1. app.log
	if entries[0].Name != "app.log" || entries[0].IsDir || entries[0].Size != 1024 || entries[0].Path != "/home/user/app.log" {
		t.Errorf("unexpected entry 0: %+v", entries[0])
	}

	// 2. run.sh
	if entries[1].Name != "run.sh" || entries[1].IsDir || entries[1].Size != 8192 {
		t.Errorf("unexpected entry 1: %+v", entries[1])
	}

	// 3. config
	if entries[2].Name != "config" || !entries[2].IsDir || entries[2].Path != "/home/user/config" {
		t.Errorf("unexpected entry 2: %+v", entries[2])
	}

	// 4. app.link (symlink name extracted)
	if entries[3].Name != "app.link" || entries[3].Path != "/home/user/app.link" {
		t.Errorf("unexpected entry 3: %+v", entries[3])
	}

	// 5. file with spaces.txt
	if entries[4].Name != "file with spaces.txt" || entries[4].Path != "/home/user/file with spaces.txt" || entries[4].Size != 500 {
		t.Errorf("unexpected entry 4: %+v", entries[4])
	}
}

func TestParseLsOutput_StandardBSD(t *testing.T) {
	output := `total 24
drwxr-xr-x   3 user  staff   96 Sep 21 12:00 .
drwxr-xr-x  10 user  staff  320 Sep 20 10:00 ..
-rw-r--r--   1 user  staff  256 Sep 21 11:22 server.conf
-rw-r--r--   1 user  staff 2048 Jan  5  2025 old_archive.tar.gz
drwxr-xr-x   2 user  staff   64 Mar 10 09:15 backup
`
	entries := ParseLsOutput(output, "/var/www")
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	if entries[0].Name != "server.conf" || entries[0].Size != 256 || entries[0].Path != "/var/www/server.conf" {
		t.Errorf("unexpected entry 0: %+v", entries[0])
	}
	if entries[1].Name != "old_archive.tar.gz" || entries[1].Size != 2048 {
		t.Errorf("unexpected entry 1: %+v", entries[1])
	}
	if entries[2].Name != "backup" || !entries[2].IsDir || entries[2].Path != "/var/www/backup" {
		t.Errorf("unexpected entry 2: %+v", entries[2])
	}
}

func TestQuoteShellArg(t *testing.T) {
	if quoteShellArg("abc") != "'abc'" {
		t.Errorf("unexpected quote: %s", quoteShellArg("abc"))
	}
	if quoteShellArg("a'b") != "'a'\\''b'" {
		t.Errorf("unexpected quote: %s", quoteShellArg("a'b"))
	}
}
