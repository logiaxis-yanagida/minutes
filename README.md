# 議事録アプリ

自分用の議事録アプリです。会議前の確認事項・アジェンダ準備、会議中のメモ（音声入力対応）とタスク記録、会議後の議事録化（Claude に貼るためのコピー）までを1つで行います。サーバー・有料 API は使いません。

## 起動方法

### PC（ローカル）

1. `起動.bat` をダブルクリックします（Python 3 が必要です）。
2. ブラウザ（Chrome または Edge）で `http://localhost:8788/` が開きます。
3. 黒いコマンド画面を閉じると停止します。

### スマホ・どこからでも（公開版）

<https://logiaxis-yanagida.github.io/minutes/> を開きます。iPhone・iPad は Safari の共有ボタンから「ホーム画面に追加」するとアプリとして使えます。

データは端末内（localStorage）に保存され、Google にサインインすると Google ドライブ経由で端末間を同期します。

## テスト

```bash
node --test
```

## Google 設定

taskapp と同じ OAuth クライアント ID を使います。Google Cloud Console の「認証情報」で、そのクライアント ID に次を追加してください。

- 承認済みの JavaScript 生成元（末尾 `/` なし）
  - `https://logiaxis-yanagida.github.io`
  - `http://localhost:8788`
- 承認済みのリダイレクト URI（末尾 `/` あり。ホーム画面アプリでの画面遷移方式サインインに使います）
  - `https://logiaxis-yanagida.github.io/minutes/`
  - `http://localhost:8788/`

使用するスコープは `calendar.readonly`（カレンダー読込）と `drive.appdata`（同期用の非公開領域）です。OAuth 同意画面のスコープにも両方を追加してください。

## アイコン

`python scripts/make_icons.py` で `icons/` 以下を再生成します（Pillow が必要です）。

## ファイル構成

構成とモジュール契約は [SPEC.md](SPEC.md) を参照してください。元の要件は [SPEC_議事録アプリ.md](SPEC_議事録アプリ.md) です。
