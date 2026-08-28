# 牌言 (Pekzep) for Minecraft 1.16.1

Minecraft: Java Edition **1.16.1** 向けの牌言語リソースパックです。訳は [Crowdin の minecraftpz](https://crowdin.com/project/minecraftpz) が正本で、このリポジトリの CD がパック zip を GitHub Releases に出します。

公式翻訳ではありません。Mojang / Microsoft とは無関係です。

## 入れ方

漢字転写と燐字は **別 zip** です。同時に入れないでください。

| パック | 内容 |
| --- | --- |
| [`pekzep-1.16.1.zip`](https://github.com/jurliyuuri/minecraft-pekzep/releases/latest/download/pekzep-1.16.1.zip) | 漢字転写 |
| [`pekzep-linzi-1.16.1.zip`](https://github.com/jurliyuuri/minecraft-pekzep/releases/latest/download/pekzep-linzi-1.16.1.zip) | 燐字（私用領域 + noborder フォント） |

1. zip を `.minecraft/resourcepacks` に置く
2. ゲーム内でリソースパックを有効にする
3. 言語で **牌言 (冠国)** を選ぶ（燐字パックではメニューも燐字になる）

1.16.1 専用です（`pack_format`: 5）。他バージョンでは動かないか、互換警告が出ます。

未訳の文字列は英語のまま入っています。燐字パックで noborder 画像が無い漢字は、漢字のまま残します。

## ローカルビルド

Crowdin から落とした JSON を `translations/pz_ai.json` か `translations/<locale>/en_us.json` に置いて:

```bash
python3 scripts/build_pack.py
```

燐字パック:

```bash
bash scripts/fetch_lin_marn.sh
mkdir -p dist
node scripts/collect_noborder.js vendor/lin-marn > dist/noborder.json
python3 scripts/build_linzi_font.py
python3 scripts/build_pack.py --linzi
```

`font/lin-marn.sha` が使う [lin-marn](https://github.com/jurliyuuri/lin-marn) の commit です。新しい noborder を取り込むときは SHA だけ更新します。

成果物は `dist/pekzep-1.16.1.zip` と `dist/pekzep-linzi-1.16.1.zip` です。zip 直下に `pack.mcmeta` があることを確認してください。

## CD

GitHub Actions が毎日（および手動実行で）Crowdin から訳を download し、漢字 zip と燐字 zip を切ります。両方の中身が前回と同じなら Release は作りません。

ソースの upload はしません。Crowdin 上の既存ファイルを上書きしないためです。

必要な repository secret:

| Secret | 内容 |
| --- | --- |
| `CROWDIN_PERSONAL_TOKEN` | Crowdin の Personal Access Token（プロジェクト ID 923393 は `crowdin.yml` に書いてある） |

```bash
gh secret set CROWDIN_PERSONAL_TOKEN --repo jurliyuuri/minecraft-pekzep
```

`crowdin.yml` の `dest` は Crowdin 上のソースパス（今は `/en_us.json`）です。ダウンロードがファイルなしで失敗するときは、プロジェクト内の実際のパスに合わせてください。
