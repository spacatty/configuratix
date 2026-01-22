-- Seed PHP extension templates (idempotent - uses ON CONFLICT)
INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Default', 'Basic PHP extensions for simple scripts', 
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip'], TRUE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions,
    is_default = EXCLUDED.is_default;

INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('WordPress', 'Extensions required for WordPress and common plugins',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'gd', 'imagick', 'exif', 'intl', 'opcache', 'redis', 'memcached', 'apcu', 'bcmath', 'soap'], FALSE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions;

INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Laravel', 'Extensions for Laravel framework',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'bcmath', 'ctype', 'fileinfo', 'tokenizer', 'redis', 'opcache', 'gd', 'intl'], FALSE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions;

INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Symfony', 'Extensions for Symfony framework',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'bcmath', 'ctype', 'intl', 'opcache', 'redis', 'yaml', 'gd'], FALSE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions;

INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Minimal', 'Minimal extensions for simple PHP scripts',
 ARRAY['mysqli', 'curl', 'mbstring'], FALSE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions;

INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Full Stack', 'Comprehensive set for most applications',
 ARRAY['mysqli', 'pdo_mysql', 'pdo_pgsql', 'curl', 'mbstring', 'xml', 'zip', 'gd', 'imagick', 'exif', 'intl', 'opcache', 'redis', 'memcached', 'apcu', 'bcmath', 'soap', 'ldap', 'imap', 'ssh2'], FALSE)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    extensions = EXCLUDED.extensions;
