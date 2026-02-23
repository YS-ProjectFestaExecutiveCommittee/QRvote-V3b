// 【重要】ここにGASのウェブアプリURLを貼り付けてください
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyU0LIvjLlKlqRMzSMX45hXTMiqt_yHry0AbKRxPGyky0QVJe2QBDrtOlIE__m7tXae/exec";
// 【重要】GAS側の SECURITY_SALT と完全に一致させてください
const SECURITY_SALT = "931810100081114514";

let isHumanInteractionDetected = false;
let pageLoadTime = Date.now();

document.addEventListener('DOMContentLoaded', () => {
    // Bot対策: 人間らしい操作（スクロール、タッチ、マウス移動）を検知
    const detectHuman = () => { isHumanInteractionDetected = true; };
    window.addEventListener('touchstart', detectHuman, { once: true });
    window.addEventListener('mousemove', detectHuman, { once: true });
    window.addEventListener('scroll', detectHuman, { once: true });

    const voteScreen = document.getElementById('vote-screen');
    const loadingScreen = document.getElementById('loading-screen');
    const successScreen = document.getElementById('success-screen');
    const errorScreen = document.getElementById('error-screen');
    const errorMessage = document.getElementById('error-message');
    const voteButton = document.getElementById('vote-button');

    const showScreen = (screenId) => {
        [voteScreen, loadingScreen, successScreen, errorScreen].forEach(el => el.classList.add('hidden'));
        document.getElementById(screenId).classList.remove('hidden');
    };

    const showError = (message) => {
        errorMessage.innerHTML = message;
        showScreen('error-screen');
    };

    // URLパラメータからブースIDを取得
    const urlParams = new URLSearchParams(window.location.search);
    const boothId = urlParams.get('booth');

    if (!boothId) {
        showError("QRコードの読み取りに失敗しました。<br>ブースIDが見つかりません。");
        return;
    }
    document.getElementById('display-booth-id').textContent = boothId;

    // 【ローカル重複チェック】 既に投票済みの場合はボタンを押させない
    if (localStorage.getItem('has_voted') === 'true') {
        showError("この端末からは既に投票済みです。<br><span style='font-size:0.8em; color:#666;'>※1端末につき全ブースを通じて1回のみ投票可能です</span>");
        return;
    }

    // 独自のローカルデバイスIDを生成・取得（Fingerprint偽装への多層防御）
    let localDeviceId = localStorage.getItem('local_device_id');
    if (!localDeviceId) {
        localDeviceId = crypto.randomUUID ? crypto.randomUUID() : 'id_' + Date.now() + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('local_device_id', localDeviceId);
    }

    // 投票ボタンクリック処理
    voteButton.addEventListener('click', async () => {
        // ハニーポットチェック
        if (document.getElementById('honey-pot').value !== "") {
            showError("不正なアクセスを検知しました。(Err: H1)");
            return;
        }

        // Botチェック (ページロードから早すぎる操作、または操作履歴がない場合)
        const interactionTime = Date.now() - pageLoadTime;
        if (interactionTime < 1000 || !isHumanInteractionDetected) {
            showError("自動化ツールによる操作が疑われます。(Err: B1)");
            return;
        }

        showScreen('loading-screen');

        try {
            // 1. 位置情報の取得
            const position = await getGeolocation();
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            // 2. 端末情報 (FingerprintJS) の取得
            const fpPromise = FingerprintJS.load();
            const fp = await fpPromise;
            const result = await fp.get();
            const visitorId = result.visitorId; // ブラウザ特有のID

            // 3. 改ざん防止トークンの生成
            const timestamp = Date.now();
            // 送信するIDは、FingerprintとローカルUUIDの両方
            const tokenPayload = visitorId + localDeviceId + boothId + timestamp + SECURITY_SALT;
            const token = await generateHashToken(tokenPayload);

            // 演出＆Bot対策のウェイト
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 4. GASへデータ送信
            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    boothId: boothId,
                    visitorId: visitorId,
                    localDeviceId: localDeviceId, // 独自IDも送信
                    lat: lat,
                    lng: lng,
                    timestamp: timestamp,
                    token: token,
                    isHuman: isHumanInteractionDetected
                })
            });

            if (!response.ok) throw new Error('Network Error');

            const jsonResponse = await response.json();

            // 5. サーバーレスポンス判定
            if (jsonResponse.result === 'success') {
                // 成功したらローカルにも投票済みフラグを記録
                localStorage.setItem('has_voted', 'true');
                showScreen('success-screen');
            } else if (jsonResponse.result === 'duplicate') {
                localStorage.setItem('has_voted', 'true'); // サーバーで弾かれた場合もローカルをロック
                showError("この端末からは既に投票済みです。<br><span style='font-size:0.8em; color:#666;'>※1投票者がどの番号にも2度以上投票することはできません</span>");
            } else if (jsonResponse.result === 'out_of_area') {
                showError(`イベント会場内からのみ投票可能です。<br><span style='font-size:0.8em; color:#666;'>(会場中心からの誤差: 約${Math.round(jsonResponse.distance)}m)</span>`);
            } else if (jsonResponse.result === 'invalid_token' || jsonResponse.result === 'bot_detected') {
                showError("不正なリクエストとしてブロックされました。<br>QRコードを再度読み込んでください。");
            } else {
                showError("システムエラーが発生しました: " + (jsonResponse.message || "不明"));
            }

        } catch (error) {
            console.error('Error:', error);
            if (error.code === 1) { // ユーザーが位置情報を拒否した場合
                showError("位置情報の取得が許可されていません。<br>ブラウザの設定で位置情報をオンにしてから再試行してください。");
            } else if (error.message === 'Timeout') {
                showError("位置情報の取得に時間がかかりすぎました。電波の良い場所でお試しください。");
            } else {
                showError("通信エラーが発生しました。ネットワーク環境をご確認ください。");
            }
        }
    });
});

// 位置情報を取得するPromise関数（タイムアウト処理付き）
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("お使いのブラウザは位置情報に対応していません。"));
        } else {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 0
            });
        }
    });
}

// SHA-256ハッシュ生成関数
async function generateHashToken(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
