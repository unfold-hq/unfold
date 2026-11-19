var REG_NONE = NewRegistrar('none');
var CF_REDIRECTS = NewDnsProvider('cloudflare_redirects', { manage_single_redirects: true });

D(
  'unfoldhq.dev',
  REG_NONE,
  DnsProvider(CF_REDIRECTS),
  DefaultTTL(1),
  AAAA('@', '100::', CF_PROXY_ON),
  AAAA('www', '100::', CF_PROXY_ON),
  AAAA('staging', '100::', CF_PROXY_ON),
  AAAA('docs', '100::', CF_PROXY_ON),
  AAAA('docs-staging', '100::', CF_PROXY_ON),

  MX('@', 71, 'route1.mx.cloudflare.net.'),
  MX('@', 36, 'route2.mx.cloudflare.net.'),
  MX('@', 17, 'route3.mx.cloudflare.net.'),
  TXT('@', 'v=spf1 include:_spf.mx.cloudflare.net ~all'),
  TXT('_dmarc', 'v=DMARC1; p=reject'),
  TXT('_gh-unfold-hq-o', '41a6656e33'),

  IGNORE('staging-app', 'CNAME'),
  IGNORE('_acme-challenge.**', 'TXT'),

  CF_SINGLE_REDIRECT(
    'www-to-apex',
    301,
    'http.host eq "www.unfoldhq.dev"',
    'concat("https://unfoldhq.dev", http.request.uri.path)',
  ),
);
