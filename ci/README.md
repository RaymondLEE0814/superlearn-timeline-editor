# CI 워크플로 설치

`github-actions-ci.yml` 이 이 프로젝트의 GitHub Actions 워크플로다.
최초 푸시에 쓴 토큰에 `workflow` 권한이 없어 `.github/workflows/` 경로로 바로 올리지 못했다.

활성화 방법 (둘 중 하나):

```bash
# 1) 권한을 추가한 뒤 제자리로 옮긴다
gh auth refresh -s workflow
mkdir -p .github/workflows
cp ci/github-actions-ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml && git commit -m "ci: GitHub Actions 워크플로 추가" && git push
```

2) 또는 GitHub 웹에서 Actions 탭 → "set up a workflow yourself" 로 이 파일 내용을 붙여 넣는다.

워크플로가 하는 일: lint → 커버리지 → fixture 재생성 diff 확인 → 빌드 → e2e.
