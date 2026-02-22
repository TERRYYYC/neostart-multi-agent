# Git Commands Used

## Check status and remotes
```bash
git status
git remote -v
```

## List untracked (new) files
```bash
git ls-files --others --exclude-standard
```

## Stage specific files/directories (excluding .claude)
```bash
git add claude-minimal/ codex-minimal/ README2.md git-readme.md test
```

## Commit
```bash
git commit -m "add minimal Codex CLI wrapper script"
```

## Push to remote
```bash
git push origin main
```
