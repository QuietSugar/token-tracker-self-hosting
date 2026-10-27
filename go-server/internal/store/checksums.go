// Code generated from contract/golden/1.4.12/static.json — DO NOT EDIT.
// PostgreSQL reference migration checksums are an audit crosswalk only.
package store

// PostgreSQLReferenceSteps contains the upstream PG migration step IDs/checksums.
// 它们只作为审计对照（audit crosswalk），不会被本服务执行——本服务用自己的
// schema_migrations / schema_additions 账本，不伪造上游的 15-step 安装记录。
var PostgreSQLReferenceSteps = []struct{ ID, Checksum string }{
	{"01-private-baseline", "071ca2557673de115bca98fba2ea1fd577ad056b96ef76ff4a44dcae5fff6470"},
	{"02-account-sessions", "980d8eeef13d68f95d4fa9c32d925b66715bd342aed9aef0872d8b416cd7eabf"},
	{"03-device-identity", "6967e029ddba62373f5e18b80cecbca2deae8f1dbeb8c2a1891ff15e5b4a85db"},
	{"04-private-aggregation", "b95a322e4c8f1a2afd038e6f3658cc9236349b8200502bd48d07d79f68204c02"},
	{"20261003120000_cloud-subscriptions", "d7ccbed0b936d8ff517a7932799770c944e6942cadb0c949b745ded799c19937"},
	{"20261004120000_cloud-machine-access", "6938d26ea6dc211db83ac6c769e9930c80b147dc2fcbe837c6902ef2dc1a394c"},
	{"20261007120000_cloud-waffo", "ee4303a99b3141015b68f960ad111672862ba9b2b2537c3d25c288eedaa66f5c"},
	{"20261007130000_cloud-waffo-retry", "ad42488cbf8279f98e269067cbfa270c692fb171bbf66d9e2350f8c6341c1a37"},
	{"20261007140000_cloud-waffo-attempts", "ad0986bc74bd4840247c898667783fd8153238262ecce0e27865bb7c9311b946"},
	{"20261007150000_cloud-waffo-authorizations", "f54e4de4009d39e1f1356a5f9fd619fddd0055bf5d836f94cee452b720a799c2"},
	{"20261007160000_cloud-waffo-sandbox-periods", "396bfab22c09a35a76510644e8ec002fa8ff48763104e1f86369c0c8b2af36d1"},
	{"10-self-hosted-policy", "3808d8964e2f987569fd6d5eb82b2fa349e2bedd6de1ad45a631ead93279cad2"},
	{"11-token-environment-validation", "08a7dd10fde98f8aafc25bd9f7bb719914498ef1b1ce5823d76d81c15af69d3d"},
	{"12-pro-gifts", "d3929a662143ab38f2e8edca5bcfd9549546e711222f4a20a6ba6c202f73d777"},
	{"13-machine-alias-cascade", "002132f9587810337d2e9f1667ce2c33bf5be2b6689cf051fa21ababc9122f53"},
}
