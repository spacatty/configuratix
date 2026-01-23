-- Security Module Tables
-- Implements IP banning, UA blocking, endpoint protection

-- Global IP bans (shared across all machines)
CREATE TABLE IF NOT EXISTS security_ip_bans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address INET NOT NULL,
    source_machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    reason VARCHAR(50) NOT NULL, -- 'blocked_ua', 'invalid_endpoint', 'manual', 'imported'
    details JSONB DEFAULT '{}',
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 month'),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    unbanned_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_security_bans_ip ON security_ip_bans(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_bans_active ON security_ip_bans(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_security_bans_sync ON security_ip_bans(banned_at, is_active);
CREATE INDEX IF NOT EXISTS idx_security_bans_reason ON security_ip_bans(reason);

-- Global whitelist (never ban these IPs)
CREATE TABLE IF NOT EXISTS security_ip_whitelist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    ip_cidr INET NOT NULL, -- supports CIDR like 192.168.1.0/24
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_whitelist_ip ON security_ip_whitelist(ip_cidr);
CREATE INDEX IF NOT EXISTS idx_security_whitelist_owner ON security_ip_whitelist(owner_id);

-- UA patterns organized by category
CREATE TABLE IF NOT EXISTS security_ua_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = system pattern
    category VARCHAR(50) NOT NULL,
    pattern TEXT NOT NULL,
    match_type VARCHAR(20) DEFAULT 'contains', -- 'contains', 'exact', 'regex'
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_ua_category ON security_ua_patterns(category);
CREATE INDEX IF NOT EXISTS idx_security_ua_owner ON security_ua_patterns(owner_id);
CREATE INDEX IF NOT EXISTS idx_security_ua_active ON security_ua_patterns(is_active, is_system);

-- Per-user category enable/disable toggles
CREATE TABLE IF NOT EXISTS security_ua_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(owner_id, category)
);

-- Endpoint allowlist rules per nginx config
CREATE TABLE IF NOT EXISTS security_endpoint_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nginx_config_id UUID REFERENCES nginx_configs(id) ON DELETE CASCADE NOT NULL,
    pattern TEXT NOT NULL, -- regex pattern for allowed paths
    description TEXT,
    priority INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_endpoint_config ON security_endpoint_rules(nginx_config_id);

-- Security settings per nginx config
CREATE TABLE IF NOT EXISTS security_config_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nginx_config_id UUID REFERENCES nginx_configs(id) ON DELETE CASCADE UNIQUE NOT NULL,
    ua_blocking_enabled BOOLEAN DEFAULT false,
    endpoint_blocking_enabled BOOLEAN DEFAULT false,
    sync_enabled BOOLEAN DEFAULT true,
    sync_interval_minutes INT DEFAULT 2,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Security settings per machine (nftables state, toggle)
CREATE TABLE IF NOT EXISTS security_machine_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID REFERENCES machines(id) ON DELETE CASCADE UNIQUE NOT NULL,
    nftables_enabled BOOLEAN DEFAULT false, -- disabled by default for safety
    last_sync_at TIMESTAMP WITH TIME ZONE,
    ban_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- Seed system UA patterns by category
-- ============================================================

-- HTTP Clients
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'http_clients', 'python-httpx', 'contains', 'Python HTTPX library', true),
(NULL, 'http_clients', 'python-requests', 'contains', 'Python Requests library', true),
(NULL, 'http_clients', 'python-urllib', 'contains', 'Python urllib', true),
(NULL, 'http_clients', 'aiohttp', 'contains', 'Python aiohttp async client', true),
(NULL, 'http_clients', 'Go-http-client', 'contains', 'Go standard HTTP client', true),
(NULL, 'http_clients', 'Java/', 'contains', 'Java HTTP client', true),
(NULL, 'http_clients', 'Apache-HttpClient', 'contains', 'Apache Java HTTP client', true),
(NULL, 'http_clients', 'OkHttp', 'contains', 'OkHttp Java/Kotlin client', true),
(NULL, 'http_clients', 'libwww-perl', 'contains', 'Perl LWP library', true),
(NULL, 'http_clients', 'node-fetch', 'contains', 'Node.js fetch', true),
(NULL, 'http_clients', 'axios/', 'contains', 'Axios JavaScript client', true),
(NULL, 'http_clients', 'httpie', 'contains', 'HTTPie CLI tool', true),
(NULL, 'http_clients', 'http.rb', 'contains', 'Ruby HTTP client', true)
ON CONFLICT DO NOTHING;

-- Scrapers & Headless Browsers
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'scrapers', 'Scrapy', 'contains', 'Python Scrapy framework', true),
(NULL, 'scrapers', 'scrapy', 'contains', 'Python Scrapy framework (lowercase)', true),
(NULL, 'scrapers', 'colly', 'contains', 'Go Colly scraper', true),
(NULL, 'scrapers', 'Puppeteer', 'contains', 'Puppeteer headless Chrome', true),
(NULL, 'scrapers', 'Playwright', 'contains', 'Playwright browser automation', true),
(NULL, 'scrapers', 'Selenium', 'contains', 'Selenium WebDriver', true),
(NULL, 'scrapers', 'HeadlessChrome', 'contains', 'Headless Chrome browser', true),
(NULL, 'scrapers', 'PhantomJS', 'contains', 'PhantomJS headless browser', true),
(NULL, 'scrapers', 'HTTrack', 'contains', 'HTTrack website copier', true),
(NULL, 'scrapers', 'WebCopier', 'contains', 'WebCopier tool', true),
(NULL, 'scrapers', 'Offline Explorer', 'contains', 'Offline Explorer', true),
(NULL, 'scrapers', 'CasperJS', 'contains', 'CasperJS navigation scripting', true)
ON CONFLICT DO NOTHING;

-- Security Scanners
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'scanners', 'zgrab', 'contains', 'ZGrab scanner', true),
(NULL, 'scanners', 'masscan', 'contains', 'Masscan port scanner', true),
(NULL, 'scanners', 'nmap', 'contains', 'Nmap scanner', true),
(NULL, 'scanners', 'Nmap', 'contains', 'Nmap scanner', true),
(NULL, 'scanners', 'nikto', 'contains', 'Nikto web scanner', true),
(NULL, 'scanners', 'sqlmap', 'contains', 'SQLMap injection tool', true),
(NULL, 'scanners', 'dirbuster', 'contains', 'DirBuster directory scanner', true),
(NULL, 'scanners', 'DirBuster', 'contains', 'DirBuster directory scanner', true),
(NULL, 'scanners', 'nuclei', 'contains', 'Nuclei vulnerability scanner', true),
(NULL, 'scanners', 'gobuster', 'contains', 'Gobuster directory scanner', true),
(NULL, 'scanners', 'ffuf', 'contains', 'Fuzz Faster U Fool', true),
(NULL, 'scanners', 'wfuzz', 'contains', 'WFuzz web fuzzer', true),
(NULL, 'scanners', 'Nessus', 'contains', 'Nessus vulnerability scanner', true),
(NULL, 'scanners', 'Acunetix', 'contains', 'Acunetix web scanner', true),
(NULL, 'scanners', 'Qualys', 'contains', 'Qualys scanner', true),
(NULL, 'scanners', 'w3af', 'contains', 'w3af web scanner', true),
(NULL, 'scanners', 'skipfish', 'contains', 'Skipfish web scanner', true),
(NULL, 'scanners', 'Burp', 'contains', 'Burp Suite scanner', true)
ON CONFLICT DO NOTHING;

-- SEO/Marketing Bots (aggressive crawlers)
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'seo_bots', 'MJ12bot', 'contains', 'Majestic SEO bot', true),
(NULL, 'seo_bots', 'AhrefsBot', 'contains', 'Ahrefs SEO crawler', true),
(NULL, 'seo_bots', 'SemrushBot', 'contains', 'Semrush SEO crawler', true),
(NULL, 'seo_bots', 'DotBot', 'contains', 'Moz DotBot crawler', true),
(NULL, 'seo_bots', 'BLEXBot', 'contains', 'BLEXBot link checker', true),
(NULL, 'seo_bots', 'PetalBot', 'contains', 'Huawei PetalBot', true),
(NULL, 'seo_bots', 'Bytespider', 'contains', 'ByteDance spider', true),
(NULL, 'seo_bots', 'DataForSeoBot', 'contains', 'DataForSEO crawler', true),
(NULL, 'seo_bots', 'serpstatbot', 'contains', 'Serpstat SEO bot', true),
(NULL, 'seo_bots', 'SEOkicks', 'contains', 'SEOkicks crawler', true),
(NULL, 'seo_bots', 'Rogerbot', 'contains', 'Moz Rogerbot', true),
(NULL, 'seo_bots', 'Screaming Frog', 'contains', 'Screaming Frog SEO spider', true)
ON CONFLICT DO NOTHING;

-- AI Crawlers
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'ai_crawlers', 'GPTBot', 'contains', 'OpenAI GPT crawler', true),
(NULL, 'ai_crawlers', 'ChatGPT-User', 'contains', 'ChatGPT browsing', true),
(NULL, 'ai_crawlers', 'CCBot', 'contains', 'Common Crawl bot', true),
(NULL, 'ai_crawlers', 'anthropic-ai', 'contains', 'Anthropic AI crawler', true),
(NULL, 'ai_crawlers', 'ClaudeBot', 'contains', 'Claude AI crawler', true),
(NULL, 'ai_crawlers', 'Claude-Web', 'contains', 'Claude web crawler', true),
(NULL, 'ai_crawlers', 'Google-Extended', 'contains', 'Google AI training crawler', true),
(NULL, 'ai_crawlers', 'Amazonbot', 'contains', 'Amazon Alexa crawler', true),
(NULL, 'ai_crawlers', 'PerplexityBot', 'contains', 'Perplexity AI crawler', true),
(NULL, 'ai_crawlers', 'YouBot', 'contains', 'You.com AI crawler', true),
(NULL, 'ai_crawlers', 'Diffbot', 'contains', 'Diffbot AI crawler', true),
(NULL, 'ai_crawlers', 'Applebot-Extended', 'contains', 'Apple AI training', true),
(NULL, 'ai_crawlers', 'cohere-ai', 'contains', 'Cohere AI crawler', true)
ON CONFLICT DO NOTHING;

-- Generic Bad Patterns
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'generic_bad', 'bot', 'contains', 'Generic bot identifier', true),
(NULL, 'generic_bad', 'Bot', 'contains', 'Generic Bot identifier', true),
(NULL, 'generic_bad', 'crawler', 'contains', 'Generic crawler identifier', true),
(NULL, 'generic_bad', 'Crawler', 'contains', 'Generic Crawler identifier', true),
(NULL, 'generic_bad', 'spider', 'contains', 'Generic spider identifier', true),
(NULL, 'generic_bad', 'Spider', 'contains', 'Generic Spider identifier', true),
(NULL, 'generic_bad', 'scan', 'contains', 'Generic scan identifier', true),
(NULL, 'generic_bad', 'Scan', 'contains', 'Generic Scan identifier', true)
ON CONFLICT DO NOTHING;

-- Empty UA (suspicious)
INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system) VALUES
(NULL, 'suspicious', '-', 'exact', 'Empty or missing user agent', true),
(NULL, 'suspicious', '', 'exact', 'Empty user agent', true)
ON CONFLICT DO NOTHING;

