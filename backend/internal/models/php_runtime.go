package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type PHPRuntime struct {
	ID           uuid.UUID      `db:"id" json:"id"`
	MachineID    uuid.UUID      `db:"machine_id" json:"machine_id"`
	Version      string         `db:"version" json:"version"`
	Extensions   pq.StringArray `db:"extensions" json:"extensions"`
	Status       string         `db:"status" json:"status"`
	SocketPath   *string        `db:"socket_path" json:"socket_path"`
	ErrorMessage *string        `db:"error_message" json:"error_message"`
	InstalledAt  *time.Time     `db:"installed_at" json:"installed_at"`
	CreatedAt    time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time      `db:"updated_at" json:"updated_at"`
}

type PHPExtensionTemplate struct {
	ID          uuid.UUID      `db:"id" json:"id"`
	Name        string         `db:"name" json:"name"`
	Description *string        `db:"description" json:"description"`
	Extensions  pq.StringArray `db:"extensions" json:"extensions"`
	IsDefault   bool           `db:"is_default" json:"is_default"`
	CreatedAt   time.Time      `db:"created_at" json:"created_at"`
}

// Available PHP versions
var PHPVersions = []string{"8.0", "8.1", "8.2", "8.3", "8.4"}

// Available PHP extensions (common ones)
var PHPExtensions = []string{
	"bcmath",
	"bz2",
	"curl",
	"dba",
	"enchant",
	"exif",
	"ffi",
	"gd",
	"gmp",
	"imap",
	"imagick",
	"intl",
	"ldap",
	"mbstring",
	"memcached",
	"mongodb",
	"mysqli",
	"odbc",
	"opcache",
	"pdo_mysql",
	"pdo_odbc",
	"pdo_pgsql",
	"pgsql",
	"pspell",
	"readline",
	"redis",
	"soap",
	"sockets",
	"sqlite3",
	"ssh2",
	"tidy",
	"xml",
	"xmlrpc",
	"xsl",
	"yaml",
	"zip",
	"apcu",
	"igbinary",
	"msgpack",
	"uuid",
	"xdebug",
}

// GetPHPSocketPath returns the socket path for a given PHP version
func GetPHPSocketPath(version string) string {
	return "/run/php/php" + version + "-fpm.sock"
}

