-- PHP Runtimes table
CREATE TABLE IF NOT EXISTS php_runtimes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    version VARCHAR(10) NOT NULL DEFAULT '8.3',
    extensions TEXT[] DEFAULT ARRAY[]::TEXT[],
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, installing, installed, failed, removing
    socket_path VARCHAR(255),
    error_message TEXT,
    installed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(machine_id) -- One PHP runtime per machine
);

-- PHP Extension Templates
CREATE TABLE IF NOT EXISTS php_extension_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    extensions TEXT[] NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default templates
INSERT INTO php_extension_templates (name, description, extensions, is_default) VALUES
('Default', 'Basic PHP extensions for simple scripts', 
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip'], TRUE),
 
('WordPress', 'Extensions required for WordPress and common plugins',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'gd', 'imagick', 'exif', 'intl', 'opcache', 'redis', 'memcached', 'apcu', 'bcmath', 'soap'], FALSE),
 
('Laravel', 'Extensions for Laravel framework',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'bcmath', 'ctype', 'fileinfo', 'tokenizer', 'redis', 'opcache', 'gd', 'intl'], FALSE),
 
('Symfony', 'Extensions for Symfony framework',
 ARRAY['mysqli', 'pdo_mysql', 'curl', 'mbstring', 'xml', 'zip', 'bcmath', 'ctype', 'intl', 'opcache', 'redis', 'yaml', 'gd'], FALSE),

('Minimal', 'Minimal extensions for simple PHP scripts',
 ARRAY['mysqli', 'curl', 'mbstring'], FALSE),

('Full Stack', 'Comprehensive set for most applications',
 ARRAY['mysqli', 'pdo_mysql', 'pdo_pgsql', 'curl', 'mbstring', 'xml', 'zip', 'gd', 'imagick', 'exif', 'intl', 'opcache', 'redis', 'memcached', 'apcu', 'bcmath', 'soap', 'ldap', 'imap', 'ssh2'], FALSE)
ON CONFLICT (name) DO NOTHING;

