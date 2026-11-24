const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { patchIssuerSource, install } = require('../scripts/install-supporter-binding-integration.cjs');

const root = path.resolve(__dirname, '..');
// Read program sources only. All executions and data writes use disposable fixtures.
const shared = process.env.DORH_SHARED_ISSUER_DIRECTORY;
function programFile(name) { return path.join(shared || path.join(root,'scripts'),name); }

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const source = '\uFEFF$script:BaseDir = $PSScriptRoot\n' +
  '$licensePanel = $null\n$grid = $null\n$txtLicense = $null\n$status = $null\n' +
  '$btnVerifyProof = $null\n$btnIssue = $null\nfunction Refresh-Grid {}\n[void]$form.ShowDialog()\n';

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-issuer-integration-'));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('shared issuer binds a legacy RH1 user and supplements the same RH1 with a signed RHB1', {
  skip: !shared && 'Set DORH_SHARED_ISSUER_DIRECTORY to verify installed program code using disposable data.',
}, () => fixture(directory => {
  const binding = require(programFile('supporter-binding.cjs'));
  const sharedReview = require(programFile('supporter-key-review.cjs'));
  const targetReview = require('../scripts/supporter-key-review.cjs');
  const issuer = crypto.generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  const key = crypto.generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  const jwk=key.publicKey.export({format:'jwk'});
  const point=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
  const device='0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
  const payload=Buffer.from(JSON.stringify({v:1,product:'DopamineRH',sid:'0029',device,ent:['custom_glass']}));
  const license=`RH1.${payload.toString('base64url')}.${crypto.sign('sha256',payload,issuer.privateKey).toString('base64url')}`;
  const records=[{SupporterId:'0029',DeviceCode:device,License:license,DisplayName:'Synthetic legacy user'}];
  const legacy=binding.plan(records,[],issuer.publicKey).rows[0];
  assert.equal(legacy.binding,null);
  assert.throws(()=>binding.issue(legacy,issuer.privateKey,issuer.publicKey),/legacy-unbound-needs-reviewed-device-proof/);
  const now=Math.floor(Date.now()/1000);
  const challenge=JSON.stringify({type:'RHC1',version:1,challenge_id:'A'.repeat(32),nonce:'B'.repeat(64),issued_at:now-1,expires_at:now+299,audience:'com.dopaminerh.supporter.device-proof'});
  const unsigned={type:'RHP1',version:2,challenge_id:'A'.repeat(32),challenge_hash:binding.sha256(challenge),hardware_protocol:'rh-hw-v1',hardware_hash:'C'.repeat(64),key_fingerprint:binding.sha256(point),public_key:point.toString('base64url'),signature_algorithm:'ecdsa-p256-sha256-x962',device_model:'iPhone15,3',os_version:'16.5.1'};
  const signature=crypto.sign('sha256',Buffer.concat([Buffer.from('DopamineRH-RHP1-Sign-v1\0'),Buffer.from(JSON.stringify(unsigned))]),key.privateKey).toString('base64url');
  const wire=JSON.stringify({...unsigned,signature});
  assert.deepEqual(sharedReview.verifyProof(wire,challenge),targetReview.verifyProof(wire,challenge));
  const bindings=[{DeviceCode:device,HardwareHash:unsigned.hardware_hash,KeyFingerprint:unsigned.key_fingerprint,PublicKey:unsigned.public_key}];
  const row=binding.plan(records,bindings,issuer.publicKey).rows[0];
  const output=binding.issue(row,issuer.privateKey,issuer.publicKey).trim().split('\n');
  assert.equal(output[0],license);
  assert.ok(output[1].startsWith('RHB1.'));
  const parts=output[1].split('.'), bytes=Buffer.from(parts[1],'base64url');
  assert.equal(JSON.parse(bytes).license_sha256,binding.sha256(license));
  assert.equal(binding.verifyCertificate(output[1],license,issuer.publicKey).key_fingerprint,unsigned.key_fingerprint);
  assert.equal(records[0].License,license);
  assert.throws(()=>sharedReview.verifyProof(wire.replace('16.5.1','16.6.1'),challenge),/invalid-device-proof-signature/);
  assert.equal(fs.readdirSync(directory).length,0);
}));

test('original issuer source opens with integrated controls and refreshes its data-bound history using synthetic users only', {
  skip: process.platform !== 'win32' || !process.env.DORH_ISSUER_SOURCE || !shared
    ? 'Optional Windows test of the owner-provided program source; no production databases are read.' : false,
}, () => {
  fixture(directory => {
    const records = ['0027', '0028'].map((id, index) => ({ SupporterId: id,
      DeviceCode: `${id}-4567-89AB-CDEF-0123-4567-89AB-CDEF`, DisplayName: `Synthetic user ${id}`,
      Note: 'TEST DATA ONLY', License: 'RH1.TEST-ONLY', FirstIssuedAt: '2026-11-12 10:20:30', LastIssuedAt: '2026-11-12 10:20:30' }));
    fs.writeFileSync(path.join(directory, 'supporters.json'), JSON.stringify(records));
    fs.writeFileSync(path.join(directory, 'supporter-device-proof-bindings.json'), '[]');
    const before = fs.readFileSync(path.join(directory, 'supporters.json'));
    fs.copyFileSync(programFile('SupporterBindingIntegration.ps1'), path.join(directory, 'SupporterBindingIntegration.ps1'));
    fs.copyFileSync(programFile('SupporterProfileIntegration.ps1'), path.join(directory, 'SupporterProfileIntegration.ps1'));
    const preview = { total: 2, eligible: 1, needsProof: 1, orphanBindings: 0, reviewSha256: 'A'.repeat(64),
      records: records.map((row, index) => ({ id: row.SupporterId, displayName: row.DisplayName,
        deviceCode: row.DeviceCode, lastIssuedAt: row.LastIssuedAt, note: row.Note,
        status: index === 0 ? 'READY_FOR_REVIEW' : 'LEGACY_UNBOUND', reviewSha256: 'B'.repeat(64) })) };
    fs.writeFileSync(path.join(directory, 'supporter-binding.cjs'),
      `if(process.argv[2] !== 'plan') process.exit(44); console.log(${JSON.stringify(JSON.stringify(preview))});`);
    fs.copyFileSync(programFile('RootHideSupporterIssuer.ico'), path.join(directory, 'RootHideSupporterIssuer.ico'));
    const original = fs.readFileSync(process.env.DORH_ISSUER_SOURCE, 'utf8');
    const instrumented = patchIssuerSource(original).replace('[void]$form.ShowDialog()', `
      $form.Show()
      [Windows.Forms.Application]::DoEvents()
      try {
        Refresh-Grid
        $txtSearch.Text = '0027'
        [Windows.Forms.Application]::DoEvents()
        if ($grid.Rows.Count -ne 1 -or -not $script:RHIntegratedBinding.Single.Enabled) { throw 'Filtered bound user unavailable' }
        $txtSearch.Text = ''
        [Windows.Forms.Application]::DoEvents()
        if ($grid.Rows.Count -ne 2) { throw 'Original history refresh lost users' }
        if (@($grid.Columns | Where-Object { $_.Name -eq 'RHBindingState' }).Count -ne 1) { throw 'Duplicate binding state column' }
        if ($grid.Rows[0].Cells['RHBindingState'].Value -ne '待设备证明') { throw 'Original descending history has wrong state' }
        if ($grid.Rows[1].Cells['RHBindingState'].Value -ne '已有设备证明') { throw 'Bound row state lost on refresh' }
        $state = $script:RHIntegratedBinding
        $strip = $state.Single.Parent
        if ($strip.Right -gt $btnCopy.Left -or $strip.Top -lt 0 -or $strip.Bottom -gt $txtLicense.Top) { throw 'Original copy/output controls overlapped' }
        $normal = Get-RHProofResultText 'REVIEW_KEY_MISMATCH'
        $migration = Get-RHProofResultText 'REVIEW_KEY_MISMATCH' $true
        $mismatch = Get-RHProofResultText 'HARDWARE_MISMATCH' $true
        $expired = Get-RHProofErrorText 'challenge-expired' $true
        if ($normal -notlike '硬件一致，设备密钥已变化（REVIEW_KEY_MISMATCH）*' -or $normal -notlike '*补发选中绑定*') { throw 'Ordinary key review guidance is missing' }
        if ($migration -notlike '*生成普通 RHC1*' -or $mismatch -notlike '*停止按原机补发*') { throw 'Migration guidance points to the wrong action' }
        if ($expired -notlike '*生成 Migration RHC1*' -or $expired -notlike '*challenge-expired*') { throw 'Retry guidance lost the original code' }
        $form.ClientSize = New-Object Drawing.Size(790, 930)
        $form.PerformLayout()
        $profileButton = @($historyPanel.Controls | Where-Object { $_.Text -eq '修改资料' })[0]
        if ($txtSearch.Right -ge $profileButton.Left -or $profileButton.Right -ge $btnLoad.Left) { throw 'Profile button overlaps search or load' }
        if ($labelId.Top + 2 -ne $lblIdValue.Top -or $labelId.Height -ne $lblIdValue.Height -or $lblIdValue.TextAlign -ne 'MiddleLeft') { throw 'Supporter ID alignment differs' }
        $deviceField = $script:RHDeviceInfo.Info
        if ($deviceField.Top -ne $txtName.Top -or $txtName.Right -ge $deviceField.Left -or $deviceField.Right -ne $txtDevice.Right -or -not $deviceField.ReadOnly) { throw 'Device info layout overlaps or is editable' }
        if ($txtNote.Right -ne $txtDevice.Right -or $deviceField.Text -ne '未上报') { throw 'Notes row or legacy placeholder changed' }
        $nameOfIcon = 'RootHideSupporterIssuer.ico'
        if ((Test-Path (Join-Path $script:BaseDir $nameOfIcon)) -and $form.Icon.Width -le 0) { throw 'Issuer icon failed to load' }
        if ($strip.Right -gt $btnCopy.Left -or $state.Rekey.Right -gt $strip.ClientSize.Width) { throw 'Minimum-width toolbar clipped' }
        $form.ClientSize = New-Object Drawing.Size(820, 950)
        $form.PerformLayout()
        $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
        try { $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height))); $bitmap.Save($env:DORH_ISSUER_MAIN_IMAGE, [Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
        [pscustomobject]@{Rows=$grid.Rows.Count; Columns=$grid.Columns.Count; BatchEnabled=$state.Batch.Enabled} | ConvertTo-Json -Compress
      } finally { $form.Close(); $form.Dispose() }
    `);
    const script = path.join(directory, 'RootHideSupporterIssuer.ps1');
    fs.writeFileSync(script, instrumented);
    const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', timeout: 45000, env: { ...process.env, DORH_ISSUER_MAIN_IMAGE:
        process.env.DORH_ISSUER_MAIN_IMAGE || path.join(directory, 'main.png') },
    }));
    assert.deepEqual(result, { Rows: 2, Columns: 6, BatchEnabled: true });
    assert.deepEqual(fs.readFileSync(path.join(directory, 'supporters.json')), before);
    assert.equal(fs.existsSync(path.join(directory, 'DopamineRH-supporter-private.pem')), false);
  });
});

test('original verifier consumes a disposable signed RHP1, preserves mismatch and explicitly migrates only the test device', {
  skip: process.platform !== 'win32' || !process.env.DORH_ISSUER_SOURCE || !shared
    ? 'Optional original-program/OpenSSL test using disposable keys and synthetic data only.' : false,
}, () => fixture(directory => {
  const binding = require('../scripts/supporter-binding.cjs');
  const issuer = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceKeys = [0, 1].map(() => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }));
  const points = deviceKeys.map(key => {
    const jwk = key.publicKey.export({ format: 'jwk' });
    return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  });
  const deviceCode = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
  const hardware = binding.sha256('synthetic iPad');
  const body = Buffer.from(JSON.stringify({ v: 1, product: 'DopamineRH', sid: '0029', device: deviceCode, ent: ['custom_glass'] }));
  const license = `RH1.${body.toString('base64url')}.${crypto.sign('sha256', body, issuer.privateKey).toString('base64url')}`;
  fs.writeFileSync(path.join(directory, 'supporters.json'), JSON.stringify([{ SupporterId: '0029', DeviceCode: deviceCode,
    DisplayName: 'Synthetic iPad', Note: 'TEST DATA ONLY', License: license, LastIssuedAt: '2026-11-12 10:20:30' }]));
  const baseline = [{ DeviceCode: deviceCode, HardwareHash: hardware, KeyFingerprint: binding.sha256(points[0]),
    PublicKey: points[0].toString('base64url'), FirstVerifiedAt: 'preserve-original-test-date' }];
  const bindingsPath = path.join(directory, 'supporter-device-proof-bindings.json');
  fs.writeFileSync(bindingsPath, JSON.stringify(baseline));
  const before = fs.readFileSync(bindingsPath);
  const timestamp = Math.floor(Date.now() / 1000);
  const challenge = { type: 'RHC1', version: 1, challenge_id: 'D'.repeat(32), nonce: 'E'.repeat(64),
    issued_at: timestamp, expires_at: timestamp + 300, audience: 'com.dopaminerh.supporter.device-proof' };
  const canonical = JSON.stringify(challenge);
  fs.writeFileSync(path.join(directory, 'supporter-device-proof-challenges.json'), JSON.stringify([{
    ChallengeId: challenge.challenge_id, State: 'ISSUED', DeviceCode: deviceCode, Canonical: canonical,
    ChallengeHash: binding.sha256(canonical), IssuedAt: timestamp, ExpiresAt: timestamp + 300, ConsumedAt: '' }]));
  const unsigned = { type: 'RHP1', version: 2, challenge_id: challenge.challenge_id, challenge_hash: binding.sha256(canonical),
    hardware_protocol: 'rh-hw-v1', hardware_hash: hardware, key_fingerprint: binding.sha256(points[1]),
    public_key: points[1].toString('base64url'), signature_algorithm: 'ecdsa-p256-sha256-x962',
    device_model: 'iPhone 13 Pro', os_version: '16.5.1' };
  const signature = crypto.sign('sha256', Buffer.concat([Buffer.from('DopamineRH-RHP1-Sign-v1\0'),
    Buffer.from(JSON.stringify(unsigned))]), deviceKeys[1].privateKey).toString('base64url');
  fs.writeFileSync(path.join(directory, 'synthetic-proof.json'), JSON.stringify({ ...unsigned, signature }));
  fs.copyFileSync(programFile('SupporterBindingIntegration.ps1'), path.join(directory, 'SupporterBindingIntegration.ps1'));
  fs.copyFileSync(programFile('SupporterProfileIntegration.ps1'), path.join(directory, 'SupporterProfileIntegration.ps1'));
  fs.writeFileSync(path.join(directory, 'supporter-binding.cjs'), `
    const binding = require(${JSON.stringify(path.join(root, 'scripts/supporter-binding.cjs'))});
    const publicKey = require('node:crypto').createPublicKey(${JSON.stringify(issuer.publicKey.export({ format: 'pem', type: 'spki' }))});
    try { binding.main(process.argv.slice(2), publicKey); } catch(e) { console.error(e.message); process.exitCode=1; }
  `);
  const original = fs.readFileSync(process.env.DORH_ISSUER_SOURCE, 'utf8');
  const instrumented = patchIssuerSource(original).replace('[void]$form.ShowDialog()', `
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    try {
      $wire = [IO.File]::ReadAllText((Join-Path $script:BaseDir 'synthetic-proof.json'))
      $rejected = $false
      try { $null = Verify-RHP1Proof ($wire.Replace('16.5.1', '16.6.1')) 'NORMAL' }
      catch { $rejected = $true }
      if (-not $rejected -or $script:Challenges[0].State -ne 'ISSUED') { throw 'Changed device metadata was accepted or consumed the challenge' }
      $verified = Verify-RHP1Proof $wire 'NORMAL'
      if ($verified.DeviceModel -ne 'iPhone 13 Pro' -or $verified.OSVersion -ne '16.5.1') { throw 'Signed metadata did not reach the issuer' }
      $txtDevice.Text = [string]$verified.DeviceCode
      $txtNote.Text = 'Keep this note'
      $metadataFile = $script:RHDeviceInfo.Path
      $pending = @(Show-RHProofDeviceInfo $verified $verified.DeviceCode)
      if ($pending[0] -notlike '*未上报' -or $pending[1] -notlike '*iPhone 13 Pro*16.5.1' -or (Test-Path $metadataFile)) { throw 'Pending review overwrote confirmed information' }
      if ($script:RHDeviceInfo.Info.Text -notlike '*iPhone 13 Pro*16.5.1*密钥待复核*') { throw 'Pending metadata was not filled in the device field' }
      if ($script:RHIntegratedBinding.Single.Enabled -or -not $script:RHIntegratedBinding.Rekey.Enabled) { throw 'Controls did not refresh before the proof dialog' }
      $matching = [pscustomobject]@{Policy='MATCH'; DeviceModel='iPhone 13 Pro'; OSVersion='16.4'}
      $null = Show-RHProofDeviceInfo $matching $verified.DeviceCode
      if ($script:RHDeviceInfo.Info.Text -notlike '*iPhone 13 Pro*16.4' -or $txtNote.Text -ne 'Keep this note') { throw 'Device information replaced the note or was not displayed' }
      $different = [pscustomobject]@{Policy='HARDWARE_MISMATCH'; DeviceModel='iPad13,4'; OSVersion='16.7'}
      $comparison = @(Show-RHProofDeviceInfo $different $verified.DeviceCode)
      if ($comparison[0] -notlike '*iPhone 13 Pro*16.4' -or $comparison[1] -notlike '*iPad Pro 11-inch (3rd generation)*iPadOS 16.7') { throw 'Mismatch lacks previous and reported metadata' }
      $persisted = Get-Content -Raw -LiteralPath $metadataFile | ConvertFrom-Json
      if ($persisted.DeviceModel -ne 'iPhone 13 Pro' -or $persisted.OSVersion -ne '16.4') { throw 'Different hardware overwrote confirmed metadata' }
      $null = Show-RHProofDeviceInfo $verified $verified.DeviceCode
      if ($script:RHDeviceInfo.Info.Text -notlike '*16.5.1*密钥待复核*') { throw 'New proof lost pending metadata' }
      $persisted = Get-Content -Raw -LiteralPath $metadataFile | ConvertFrom-Json
      if ($persisted.OSVersion -ne '16.4') { throw 'Pending metadata overwrote the confirmed version' }
      if ((Format-RHReportedDevice 'iOS' '16.0.2') -ne '型号未上报 · iOS 16.0.2') { throw 'An OS name was presented as a device model' }
      if ($verified.Policy -ne 'REVIEW_KEY_MISMATCH') { throw 'Original verifier lost mismatch policy' }
      Refresh-RHIntegratedBindingPlan
      $state = $script:RHIntegratedBinding
      $grid.ClearSelection(); $grid.Rows[0].Selected = $true
      if ($state.Single.Enabled -or -not $state.Rekey.Enabled) { throw 'Original proof did not persist blocking review' }
      $oldFingerprint = [string]$script:Bindings[0].KeyFingerprint
      function Confirm-RHIntegratedKeyReview($Plan) { return '0029' }
      function Show-RHIntegratedBindingMessage($Message, $Failed = $false) { if ($Failed) { throw $Message } }
      Set-DeviceState 'RHP1 签名有效，但 Hardware 相同 / Device Key 不同' 'Warning'
      Start-RHIntegratedKeyMigration
      if ($lblDeviceState.Text -ne '✓ 同设备密钥已更新 · 请补发绑定授权' -or $topStatus.Text -ne '● 同设备密钥已更新') { throw 'Successful key migration retained a stale mismatch warning' }
      if (-not $state.Single.Enabled -or $state.Rekey.Enabled) { throw 'Explicit migration did not restore supplement review' }
      if ($script:RHDeviceInfo.Info.Text -notlike '*iPhone 13 Pro*16.5.1' -or $script:RHDeviceInfo.Pending.Count -ne 0) { throw 'Confirmed migration did not promote device information' }
      $persisted = Get-Content -Raw -LiteralPath $metadataFile | ConvertFrom-Json
      if ($persisted.OSVersion -ne '16.5.1' -or $txtNote.Text -ne 'Keep this note') { throw 'Rekey did not persist metadata or overwrote the note' }
      if ([string]$script:Bindings[0].KeyFingerprint -eq $oldFingerprint) { throw 'Original verifier memory not reloaded after migration' }
      [pscustomobject]@{Policy=$verified.Policy; State=$script:Challenges[0].State; SupplementEnabled=$state.Single.Enabled} | ConvertTo-Json -Compress
    } finally { $form.Close(); $form.Dispose() }
  `);
  const script = path.join(directory, 'RootHideSupporterIssuer.ps1');
  fs.writeFileSync(script, instrumented);
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy',
    'Bypass', '-File', script], { encoding: 'utf8', timeout: 45000 }));
  assert.deepEqual(result, { Policy: 'REVIEW_KEY_MISMATCH', State: 'CONSUMED', SupplementEnabled: true });
  const updated = JSON.parse(fs.readFileSync(bindingsPath));
  assert.equal(updated[0].KeyFingerprint, binding.sha256(points[1]));
  assert.equal(updated[0].FirstVerifiedAt, baseline[0].FirstVerifiedAt);
  const backups = fs.readdirSync(path.join(directory, 'binding-backups')).map(name => path.join(directory, 'binding-backups', name));
  assert.equal(backups.filter(dir => fs.existsSync(path.join(dir, 'supporter-device-proof-bindings.json')))
    .some(dir => fs.readFileSync(path.join(dir, 'supporter-device-proof-bindings.json')).equals(before)), true);
  assert.equal(fs.existsSync(path.join(directory, 'DopamineRH-supporter-private.pem')), false);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('-bound.txt')), false);
}));
