# Security, Privacy, and Permission Model

## Security objective

AccessPath combines untrusted web execution with privileged local source-code
repair. The product is secure only if page content, captured artifacts, agent
prompts, shell commands, and filesystem operations remain inside explicit
authority boundaries.

A Git worktree protects the base checkout. It is not an operating-system
sandbox.

## Protected assets

- Qoder personal access token and session credentials
- Local repository contents and history
- Base checkout and uncommitted user work
- Browser credentials and submitted form values
- Audit screenshots and accessibility snapshots
- Local filesystem outside the repair worktree
- Command execution and network access
- Integrity of evidence and approval history

## Threat actors and inputs

- Malicious or compromised audited page
- Prompt injection embedded in page text, ARIA labels, code, comments, or
  dependency files
- Malformed audit bundle
- Accidental broad agent edit
- Destructive or hanging project scripts
- Cross-site request to the localhost companion
- Path traversal, symlink, junction, or Git worktree escape
- Secret leakage through events, logs, screenshots, reports, or command output

## Local companion protection

- Bind to `127.0.0.1`, never `0.0.0.0`.
- Select a random available port.
- Generate a high-entropy bearer token on every launch.
- Place the token in the launched console URL fragment or another mechanism
  that does not send it to remote origins.
- Validate `Origin` and `Host`.
- Use a narrow origin allowlist; never wildcard CORS.
- Reject requests without the launch token.
- Set `Cache-Control: no-store` on sensitive API responses.
- Do not expose repository paths in browser storage or exported reports.
- Display a persistent connection state in the UI.

## Target URL policy

Two explicit modes exist.

### Public target

- Allow `https:` only for the hackathon.
- Resolve hostnames before navigation.
- Reject loopback, private, link-local, multicast, unspecified, and cloud
  metadata ranges for IPv4 and IPv6.
- Revalidate every redirect destination and DNS result.
- Reject embedded credentials.
- Limit redirects, response size, navigation time, and total audit duration.
- Deny `file:`, `data:`, `javascript:`, browser-internal, and custom protocols.

### Local explicit target

- Require the user to choose `Local or private target`.
- Permit `http://localhost`, loopback, and explicitly entered private hosts.
- Show that the audit runs locally and is not shareable by default.
- Never upload the URL, cookies, page content, or evidence.
- Apply the same protocol, timeout, download, and browser-context restrictions.

## Browser isolation

- Use a fresh Playwright browser context per run.
- Chromium only for MVP.
- Disable downloads or store them in a disposable directory and delete them.
- Grant no browser permissions by default.
- Do not install extensions.
- Do not mount the repository or artifact root into page-accessible contexts.
- Block navigation to disallowed protocols.
- Close popups outside the target policy.
- Clear context storage after the run.
- Limit console and network logs to redacted summaries.
- Stop on real payment, real submission, CAPTCHA, MFA, or destructive actions.

Authentication, when demonstrated, must use fictional fixture credentials.
Production credentials are out of scope.

## Prompt-injection boundary

Page content and repository content are untrusted data.

- The audit engine never turns raw page instructions into shell commands.
- The Qoder repair prompt uses normalized findings, approved reproduction
  steps, artifact references, constraints, and selected source scope.
- Mark quoted page and code content as evidence, not instructions.
- Never tell Qoder to follow instructions discovered inside the target app.
- Agent output cannot widen permissions.
- Tool policy is enforced by the host even if a prompt requests otherwise.

## Repository and worktree controls

- Resolve and canonicalize the repository root.
- Require a valid Git repository.
- Require a clean base checkout for the MVP.
- Record base branch and commit.
- Create the repair branch and worktree under `.accesspath/worktrees`.
- Set Qoder's working directory to the worktree.
- Canonicalize every requested or reported path.
- Reject any path outside the worktree.
- Resolve and reject symlink or Windows junction escapes.
- Never expose the base checkout as an editable tool root.
- Never run `git push`, merge, rebase, reset-hard, clean, or branch deletion
  through the agent.
- On cleanup, verify the target is the application-owned worktree before
  removal.

## Qoder permission tiers

### Pre-authorized

- Read files inside the worktree
- List files inside the worktree
- Search text inside the worktree
- Read approved evidence artifacts
- Read Git status and diff

### Brokered by policy

- Edit or write files matching approved path globs
- Execute exact configured test, lint, typecheck, build, or preview commands
- Rewind files after dry-run preview and user confirmation

### Explicit approval required

- New command not already configured
- Package installation
- Network access
- Adding or changing dependencies
- Creating files outside approved globs
- Destructive command category

### Always denied in MVP

- Access outside worktree and approved artifacts
- Qoder permission bypass
- Git push, remote mutation, merge, or deploy
- Credential-store access
- Arbitrary browser cookie access
- Operating-system settings or unrelated processes

The host, not the prompt, determines these tiers.

## Command policy

Represent commands as executable plus argument array, not a free-form shell
string. Prefer spawning without an interpolating shell.

Allow configured categories:

- start
- test
- lint
- typecheck
- build

Validate:

- executable allowlist or repository package script
- working directory under worktree
- argument count and size
- timeout
- environment allowlist
- no output redirection to arbitrary paths

Reject command tokens or executables associated with:

- filesystem deletion outside known generated directories
- disk formatting or system shutdown
- credential access
- remote shell or tunnel
- Git remote mutation
- package publishing
- process injection

Terminate the complete owned process tree on timeout or cancellation.

## Secret handling

- Read Qoder credentials from `QODER_PERSONAL_ACCESS_TOKEN` or supported local
  Qoder authentication.
- Pass only required environment variables to the SDK host.
- Remove cloud, package, SSH, and unrelated developer secrets from child
  environments.
- Never persist the token.
- Redact authorization headers, cookies, query tokens, passwords, form values,
  and common secret patterns from logs and events.
- Use test fixture data in the emergency-aid application.
- Run a release secret scan over source, `.accesspath`, reports, and recorded
  demo assets.

## Artifact policy

Artifact sensitivity:

- `public`: safe fixture and submission material
- `project`: local project evidence, excluded from public export by default
- `redacted`: sanitized derivative; original is ephemeral or protected

Every artifact has SHA-256 integrity metadata. Reports link to artifact IDs,
not arbitrary filesystem paths. Retention and cleanup are explicit user
actions.

## Approval integrity

Record:

- request ID and kind
- exact paths or command
- consequence
- risk category
- user decision
- timestamp
- session policy scope

An approval cannot be reused for a different command, widened path, or later
session. `Approve session` applies only to the exact normalized operation
pattern displayed.

## Rewind safety

- Run Qoder rewind in dry-run or preview mode first.
- Compare the preview with Git status and diff.
- Display affected files and invalidated verification.
- Require explicit confirmation.
- Record a new event after rewind.
- Warn that file rewind does not reverse install scripts, network calls,
  database changes, or other command side effects.
- Never improvise rewind with destructive Git commands.

## Security test matrix

| Area | Required test |
|---|---|
| Local API | Missing token, wrong origin, wrong host, wildcard CORS absent |
| URL policy | Private IP in public mode, IPv6 loopback, metadata IP, redirect to private IP, unsupported protocol |
| Browser | Popup, download, permission request, timeout, oversized response |
| Paths | `..`, absolute escape, symlink escape, Windows junction escape |
| Git | Dirty base, non-repo path, worktree conflict, base status unchanged |
| Commands | Unapproved command, shell metacharacters, path escape, timeout, process-tree termination |
| Qoder | Unauthorized edit, external network request, expired auth, cancellation |
| Redaction | Token, cookie, password, query secret, form secret, absolute path |
| Events | Duplicate approval, stale state, reconnect, corrupt event line |
| Export | No token, cookie, raw secret, or absolute path |

## Security release gates

- No source mutation outside a generated worktree.
- No remote Git mutation path exists.
- No unrestricted Qoder permission mode exists.
- Public-target policy passes DNS and redirect tests.
- Local companion rejects cross-origin requests.
- Secrets are absent from logs, reports, build artifacts, and demo recording.
- Cancellation terminates all owned child processes.
- Security limitations are stated in the final evidence report.
