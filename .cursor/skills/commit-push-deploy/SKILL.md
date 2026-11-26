---
name: commit-push-deploy
description: Commit, push nhanh hien tai + dong bo main (deploy Workers Builds). Neu user noi "ca nhanh ben kia" thi dong bo them cac nhanh feature lien quan. Goi bang /commit-push-deploy.
disable-model-invocation: true
icon: rocket
color: orange
---

# Commit & Push & Deploy (QH-Hue)

Lam ngay — khong hoi lai trong cung phien, tru thieu thong tin bat buoc.

## Buoc chinh

1. `git status` + `git diff` + `git branch -vv` + `git log -5 --oneline` (song song).
2. Ghi `BRANCH` = nhanh hien tai (`git branch --show-current`).
3. Chi stage file code/docs/test/skill/quy tac lien quan (khong `.env`, secrets, GeoJSON/TIF/XLSX/PDF nang, symlink materialize, bulk `data/chuyen-nganh`).
4. Neu co thay doi: commit message tieng Viet khong dau, 1–2 cau. PowerShell: `git commit -m "..."` (khong HEREDOC bash).
5. `git push -u origin HEAD` (push nhanh dang dung; khong force push).
6. **Deploy qua `main`:**
   - Neu `BRANCH` la `main`: xong buoc push.
   - Neu `BRANCH` khac `main`: `git checkout main` → `git pull --ff-only` (neu can) → `git merge --ff-only BRANCH` (neu ff duoc; neu khong thi `git merge BRANCH` khong de conflict mo) → `git push origin main` → `git checkout BRANCH`.
7. Xac nhan `https://qh-hue.donghoangsxd.workers.dev/version.json` — `commit` trung tip `main` (hoac bao dang build). Chi `npx wrangler deploy` khi user yeu cau tay / Builds ket.

## Ca nhanh ben kia

Khi user noi «ca nhanh ben kia», «ca feature», hoac liet ke ten nhanh:

1. Lay danh sach nhanh feature local/remote lien quan (uu tien `feature/*` dang track, dang lech sau `main`).
2. Voi moi nhanh `F` (tru `main` / `data/*` neu user khong neu):
   - `git checkout F`
   - `git merge --ff-only main` neu ff duoc; neu khong, `git merge main` chi khi conflict don gian giai duoc; conflict phuc tap thi dung va bao user.
   - `git push origin F`
3. Quay lai `BRANCH` ban dau.
4. Bao user: cac nhanh da sync + ma commit `main` (deploy).

Mac dinh «nhanh ben kia» neu user khong ten: cac `feature/*` local con track `origin` va dang sau `main` (vi du `feature/truc-a-dvhc-class-legend`, `feature/catalog-name-link-zoom`). Khong dung `data/*` tru khi user yeu cau.

## Cam

- Khong `git push --force`, `reset --hard`, xoa remote branch.
- Khong commit bulk GIS / materialize.
- Khong amend commit da push.
