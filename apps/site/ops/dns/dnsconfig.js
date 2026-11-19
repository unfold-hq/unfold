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
  TXT('cf2024-1._domainkey', 'v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB'),
  TXT('_dmarc', 'v=DMARC1; p=reject'),
  TXT('_gh-unfold-hq-o', '41a6656e33'),
  TXT('_visual-studio-marketplace-unfold-hq', '9fd376d4-57b2-4fd5-b9ad-29ed8c480bd2'),

  IGNORE('staging-app', 'CNAME'),
  IGNORE('_acme-challenge.**', 'TXT'),

  CF_SINGLE_REDIRECT(
    'www-to-apex',
    301,
    'http.host eq "www.unfoldhq.dev"',
    'concat("https://unfoldhq.dev", http.request.uri.path)',
  ),
);
