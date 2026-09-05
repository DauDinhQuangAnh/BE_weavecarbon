const fs = require('fs');

function escapeWorkflowCommand(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

const reportPath = process.argv[2];

if (!reportPath || !fs.existsSync(reportPath)) {
  console.error('::error title=Trivy report missing::Expected a JSON report path.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const findings = (report.Results || []).flatMap((result) =>
  (result.Vulnerabilities || [])
    .filter((finding) => finding.Severity === 'CRITICAL')
    .map((finding) => ({
      target: result.Target || 'container image',
      id: finding.VulnerabilityID || 'unknown vulnerability',
      packageName: finding.PkgName || 'unknown package',
      installedVersion: finding.InstalledVersion || 'unknown',
      fixedVersion: finding.FixedVersion || 'not published',
    }))
);

if (findings.length === 0) {
  console.log('Trivy policy passed: no fixed CRITICAL vulnerabilities found.');
  process.exit(0);
}

for (const finding of findings) {
  const title = escapeWorkflowCommand(`CRITICAL ${finding.id}`);
  const message = escapeWorkflowCommand(
    `${finding.target}: ${finding.packageName} ${finding.installedVersion}; fixed in ${finding.fixedVersion}`
  );
  console.error(`::error title=${title}::${message}`);
}

console.error(`Backend image rejected: ${findings.length} fixed CRITICAL vulnerability finding(s).`);
process.exit(1);
