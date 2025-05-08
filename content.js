let isMosaicEnabled = false;
let startX, startY, endX, endY;
let isDragging = false; // ページ全体でのドラッグ状態 (モザイク作成用)
let mosaicDiv = null; // モザイク作成中の仮表示用DIV
let mosaicElements = []; // 作成されたモザイク要素を管理する配列
let selectedMosaicElement = null; // 選択中のモザイク要素
let isDraggingMosaic = false; // モザイク要素自体のドラッグ状態
let dragOffsetX, dragOffsetY; // モザイクドラッグ開始時のオフセット
let isResizingMosaic = false; // モザイクのリサイズ状態
let resizeDirection = null; // リサイズ方向
let resizeStartX, resizeStartY; // リサイズ開始時のマウス座標
let initialMosaicRect = null; // リサイズ開始時のモザイク要素の矩形情報
let lastContextMenuTime = 0;
let lastContextMenuTarget = null;
const doubleClickThreshold = 500; // ダブルクリックと判定する時間 (ミリ秒)

// 初期状態をストレージから読み込む
chrome.storage.sync.get('isEnabled', (data) => {
  isMosaicEnabled = data.isEnabled || false;
  updateBodyCursor();
});

// --- ヘルパー関数 ---
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// YouTubeページからチャンネル情報を抽出する試み
function getChannelInfoFromYouTubePage() {
    // チャンネルページのURL形式の例:
    // https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxx
    // https://www.youtube.com/@channelName
    // 動画ページのメタタグやリンクからチャンネルURLを探す

    // 1. メタタグから (例: <meta itemprop="channelId" content="UC...">)
    const metaChannelId = document.querySelector('meta[itemprop="channelId"]');
    if (metaChannelId && metaChannelId.content) {
        return { type: 'id', value: metaChannelId.content };
    }

    // 2. JSON-LD scriptタグから
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'VideoObject' && data.author && data.author.identifier) {
                return { type: 'id', value: data.author.identifier };
            }
            if (data['@type'] === 'WebPage' && data.author && data.author.url && data.author.url.includes('/channel/')) {
                const match = data.author.url.match(/\/channel\/([^/?]+)/);
                if (match && match[1]) return { type: 'id', value: match[1] };
            }
        } catch (e) { /* JSON parse error, ignore */ }
    }

    // 3. カノニカルリンクからチャンネルURLを探す
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonicalLink && canonicalLink.href) {
        const urlStr = canonicalLink.href;
        if (urlStr.includes('/@')) {
            const match = urlStr.match(/youtube\.com\/(@[^/?]+)/);
            if (match && match[1]) return { type: 'handle', value: match[1] };
        } else if (urlStr.includes('/channel/')) {
            const match = urlStr.match(/youtube\.com\/channel\/([^/?]+)/);
            if (match && match[1]) return { type: 'id', value: match[1] };
        }
    }

    // 4. ytd-video-owner-renderer 要素の href から (動画ページ)
    const ownerElement = document.querySelector('ytd-video-owner-renderer a#avatar-btn, ytd-video-owner-renderer a.yt-simple-endpoint');
    if (ownerElement && ownerElement.href) {
        const href = ownerElement.href;
        if (href.includes('/@')) {
            const match = href.match(/youtube\.com\/(@[^/?]+)/);
            if (match && match[1]) return { type: 'handle', value: match[1] };
        } else if (href.includes('/channel/')) {
            const match = href.match(/youtube\.com\/channel\/([^/?]+)/);
            if (match && match[1]) return { type: 'id', value: match[1] };
        }
    }
    
    // 5. 現在のページのURLから直接取得 (チャンネルページ自体の場合)
    if (window.location.hostname.includes('youtube.com')) {
        if (window.location.pathname.startsWith('/channel/')) {
            const parts = window.location.pathname.split('/');
            if (parts.length > 2 && parts[2]) {
                return { type: 'id', value: parts[2] };
            }
        } else if (window.location.pathname.startsWith('/@')) {
            const parts = window.location.pathname.split('/');
            if (parts.length > 1 && parts[1]) {
                return { type: 'handle', value: parts[1] }; // @を含むハンドル名
            }
        }
    }
    return null;
}

// 指定されたURLに基づいてストレージキーを決定する
function getStorageKeyForUrl(urlString) { // urlString は service-worker が検知した、遷移先のURL
    try {
        const targetUrl = new URL(urlString);
        // YouTubeの動画ページ(/watch)であっても、この関数ではチャンネルキーへの変換を積極的に行わない。
        // DOMにアクセスできないコンテキスト(service-workerからの呼び出し時)での推測は不安定なため。
        // 実際のチャンネルキーへの変換は、DOMアクセス可能な loadMosaicsFromStorage 関数内で行う。
        if (targetUrl.hostname === 'www.youtube.com' || targetUrl.hostname === 'youtube.com' || targetUrl.hostname === 'm.youtube.com') {
            // 例えば、将来的にURL自体にチャンネルIDが含まれるなど、DOM不要で特定できる情報があればここで処理も可能。
            // 現状では、YouTubeのページであればurlStringをそのまま返す。
            return urlString;
        }
    } catch (e) {
        console.error("Invalid URL for getStorageKeyForUrl:", urlString, e);
    }
    // YouTube以外、または上記で処理されなかった場合は、元のurlStringをキーとして返す
    return urlString;
}

// 現在のcontent.jsが実行されているページのストレージキーを取得する
function getMyStorageKey() {
    const currentUrl = window.location.href;
    try {
        const url = new URL(currentUrl);
        if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' || url.hostname === 'm.youtube.com') {
            // ★★★ YouTubeの動画ページ (/watch) の場合のみチャンネルキーを使用 ★★★
            if (url.pathname.startsWith('/watch')) {
                const channelInfo = getChannelInfoFromYouTubePage();
                if (channelInfo) {
                    if (channelInfo.type === 'id') {
                        return `youtube.com/channel/${channelInfo.value}`;
                    } else if (channelInfo.type === 'handle') {
                        return `youtube.com/${channelInfo.value}`;
                    }
                }
                // チャンネル情報が見つからない/watchページは、フォールバックとしてURL全体を使う
                console.warn("YouTube /watch page, but channel info not found. Falling back to full URL for key.");
            } // /watch 以外のYouTubeページ (チャンネルページ等) はそのままURLをキーとする
        }
    } catch (e) {
        console.error("Invalid URL for getMyStorageKey:", currentUrl, e);
    }
    return currentUrl; // デフォルトは現在のURL
}

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "loadMosaics") {
    // message.url は service-worker から渡された、そのタブのURL
    const storageKey = getStorageKeyForUrl(message.url);
    console.log(`Received loadMosaics request for URL: ${message.url}, using storageKey: ${storageKey}`);
    loadMosaicsFromStorage(storageKey)
        .then(() => sendResponse({ success: true }))
        .catch(e => {
            console.error("Error in loadMosaicsFromStorage:", e);
            sendResponse({ success: false, error: e.message });
        });
    return true; // 非同期応答を示すために true を返す
  } else if (message.type === 'TOGGLE_MOSAIC') {
    // 既存のpopup.jsからのメッセージ処理
    isMosaicEnabled = message.payload;
    updateBodyCursor();
    if (!isMosaicEnabled) {
        deselectMosaic();
        if (mosaicDiv) {
            mosaicDiv.remove();
            mosaicDiv = null;
            isDragging = false;
        }
        isDraggingMosaic = false;
        isResizingMosaic = false;
    }
  } else if (message.action === "clearMosaicsIfMatch") { // ★★★ 新しいアクションを処理 ★★★
    // message.url には削除対象となったストレージキーが渡ってくる
    const keyToDelete = message.url;
    const currentStorageKey = getMyStorageKey(); // 現在のページのキーと比較
    console.log(`Received clearMosaicsIfMatch request for key: ${keyToDelete}. Current page key: ${currentStorageKey}`);
    // 現在のページのURLと削除対象のURLが一致するか確認
    if (keyToDelete === currentStorageKey) {
      console.log("Storage key match found. Clearing mosaics on the current page.");
      clearAllMosaics(); // モザイクをクリア
    } else {
      console.log("Storage key does not match the current page. No mosaics cleared.");
    }
    // このアクションに対する応答は特に不要なので、true を返さない
  } else if (message.action === "switchPreset") { // ★★★ プリセット切り替え処理を修正 ★★★
    const storageKey = getMyStorageKey(); // 現在のページのキーで操作
    console.log(`Received switchPreset request for preset: "${message.presetName}", using storageKey: ${storageKey}`);
    (async () => { // 即時実行非同期関数でラップ
        try {
            const data = await chrome.storage.local.get(storageKey);
            const storageData = data[storageKey];
            if (!storageData?.presets?.[message.presetName]) {
                 console.warn(`Preset "${message.presetName}" not found for key ${storageKey}. Switch aborted.`);
                 sendResponse({ success: false, error: `Preset "${message.presetName}" not found.` });
                 return; // 処理中断
            }

            // プリセットが存在すれば更新・読み込み
            await updateActivePreset(storageKey, message.presetName); // キーを渡す
            await loadMosaicsFromStorage(storageKey); // キーを渡す
            sendResponse({ success: true }); // 成功応答
        } catch (error) {
            console.error("Error processing switchPreset:", error);
            sendResponse({ success: false, error: error.message }); // 失敗応答
        }
    })(); // 即時実行
    return true; // 非同期応答を示す
  } else if (message.action === "getCurrentMosaics") { // ★★★ 現在のモザイク情報をpopupに送る処理を追加 ★★★
      console.log("Received getCurrentMosaics request");
      const currentMosaics = getCurrentMosaicsData();
      sendResponse({ mosaics: currentMosaics });
      return true; // 非同期応答
  }
  // ★★★ popup.jsが現在のタブのストレージキーを取得するためのハンドラ ★★★
  else if (message.action === "getMyStorageKey") {
      const key = getMyStorageKey();
      console.log("Received getMyStorageKey request, sending key:", key);
      sendResponse({ storageKey: key });
      // sendResponseが同期的に呼ばれる場合、trueを返さなくても良いが、念のため
      return true;
  }
});

function updateBodyCursor() {
  // リサイズ中や移動中はカーソルを変更しない（各要素やハンドルで制御）
  if (isResizingMosaic || isDraggingMosaic) return;

  // モザイク機能がONの場合のみ crosshair にする
  if (isMosaicEnabled) {
    document.body.style.cursor = 'crosshair';
  } else {
    document.body.style.cursor = 'default';
  }
}

document.addEventListener('mousedown', (e) => {
  // モザイク要素自体やリサイズハンドルをクリックした場合は、それぞれのリスナーで処理
  if (e.target.classList.contains('mosaic-element') || e.target.classList.contains('resize-handle')) {
    return;
  }

  // モザイク作成プロセスを開始
  if (!isMosaicEnabled || isDraggingMosaic || isResizingMosaic) return; // 機能OFF、移動中、リサイズ中は新規作成しない

  // 他の場所をクリックしたら選択解除
  deselectMosaic();

  // 既存の作成中モザイクがあれば削除
  if (mosaicDiv) {
      mosaicDiv.remove();
      mosaicDiv = null;
  }

  isDragging = true; // ページ全体でのドラッグ開始
  startX = e.clientX + window.scrollX;
  startY = e.clientY + window.scrollY;

  mosaicDiv = document.createElement('div');
  mosaicDiv.style.position = 'absolute';
  mosaicDiv.style.border = '2px dashed red'; // ドラッグ中の範囲を視覚化
  mosaicDiv.style.pointerEvents = 'none'; // 下の要素をクリックできるように
  mosaicDiv.style.zIndex = '9999'; // 最前面に表示
  document.body.appendChild(mosaicDiv);

  updateMosaicDiv(e.clientX, e.clientY);
});

document.addEventListener('mousemove', (e) => {
    // モザイク要素のドラッグ処理
    if (isDraggingMosaic && selectedMosaicElement) {
        dragMosaic(e);
        return;
    }
    // モザイクのリサイズ処理
    if (isResizingMosaic && selectedMosaicElement) {
        resizeMosaic(e);
        return;
    }

    // モザイク作成中の範囲更新処理
    if (!isMosaicEnabled || !isDragging) return;
    updateMosaicDiv(e.clientX, e.clientY);
});


function updateMosaicDiv(currentX, currentY) {
    if (!mosaicDiv) return; // mosaicDiv がなければ何もしない
    const currentScrollX = window.scrollX;
    const currentScrollY = window.scrollY;
    endX = currentX + currentScrollX;
    endY = currentY + currentScrollY;

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    mosaicDiv.style.left = `${left}px`;
    mosaicDiv.style.top = `${top}px`;
    mosaicDiv.style.width = `${width}px`;
    mosaicDiv.style.height = `${height}px`;
}

document.addEventListener('mouseup', (e) => {
    // モザイク要素のドラッグ終了処理
    if (isDraggingMosaic) {
        stopMosaicDrag();
        return;
    }
    // モザイクのリサイズ終了処理
    if (isResizingMosaic) {
        stopResize();
        return;
    }

    // モザイク作成完了処理
    if (!isMosaicEnabled || !isDragging) return;

    isDragging = false; // ページ全体でのドラッグ終了
    endX = e.clientX + window.scrollX;
    endY = e.clientY + window.scrollY;

    // ドラッグ範囲の枠線は削除
    if (mosaicDiv) {
        mosaicDiv.remove();
        mosaicDiv = null;
    }

    // クリックまたは非常に小さいドラッグの場合はモザイクをかけない
    if (Math.abs(endX - startX) < 5 || Math.abs(endY - startY) < 5) {
        updateBodyCursor(); // カーソルを更新
        return;
    }

    applyMosaic(startX, startY, endX, endY);
    updateBodyCursor(); // カーソルを更新
});

function applyMosaic(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  if (width < 5 || height < 5) return; // 小さすぎるモザイクは作成しない

  const newMosaicId = generateUUID(); // 新しいIDを生成
  createMosaicElement(newMosaicId, left, top, width, height);

  saveMosaicsToStorage();
}

// モザイク要素を作成、設定、追加する関数
function createMosaicElement(id, left, top, width, height) {
  const mosaicElement = document.createElement('div');
  mosaicElement.classList.add('mosaic-element');
  mosaicElement.dataset.mosaicId = id; // 一意なIDを設定
  mosaicElement.style.position = 'absolute';
  mosaicElement.style.left = `${left}px`;
  mosaicElement.style.top = `${top}px`;
  mosaicElement.style.width = `${width}px`;
  mosaicElement.style.height = `${height}px`;
  mosaicElement.style.backdropFilter = 'blur(10px)';
  mosaicElement.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
  mosaicElement.style.zIndex = '9998';
  mosaicElement.style.cursor = 'move';
  mosaicElement.style.pointerEvents = 'auto';
  mosaicElement.style.boxSizing = 'border-box';
  mosaicElement.style.border = 'none'; // 初期状態はボーダーなし

  // --- リサイズハンドルの追加 ---
  const directions = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
  directions.forEach(dir => {
      const handle = document.createElement('div');
      handle.classList.add('resize-handle');
      handle.dataset.direction = dir;
      handle.style.position = 'absolute';
      handle.style.width = '10px';
      handle.style.height = '10px';
      handle.style.backgroundColor = 'blue';
      handle.style.border = '1px solid white';
      handle.style.borderRadius = '50%';
      handle.style.zIndex = '9999';
      handle.style.display = 'none';
      handle.style.transform = 'translate(-50%, -50%)';

      if (dir.includes('n')) handle.style.top = '0%';
      if (dir.includes('s')) handle.style.top = '100%';
      if (dir === 'n' || dir === 's') handle.style.left = '50%';
      if (dir.includes('w')) handle.style.left = '0%';
      if (dir.includes('e')) handle.style.left = '100%';
      if (dir === 'w' || dir === 'e') handle.style.top = '50%';

      if (dir === 'nw' || dir === 'se') handle.style.cursor = 'nwse-resize';
      else if (dir === 'ne' || dir === 'sw') handle.style.cursor = 'nesw-resize';
      else if (dir === 'n' || dir === 's') handle.style.cursor = 'ns-resize';
      else if (dir === 'w' || dir === 'e') handle.style.cursor = 'ew-resize';


      handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!isMosaicEnabled) return;
          startResize(e, dir, mosaicElement);
      });
      mosaicElement.appendChild(handle);
  });

  // モザイク要素をクリックしたときの処理 (選択)
  mosaicElement.addEventListener('click', (e) => {
      e.stopPropagation();
      selectMosaic(mosaicElement);
  });

  // モザイク要素のドラッグ開始処理
  mosaicElement.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle')) return;
      e.stopPropagation();
      if (!isMosaicEnabled) return;
      selectMosaic(mosaicElement);
      startMosaicDrag(e, mosaicElement);
  });

  // 右クリック -> ダブルクリックで削除
  mosaicElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isMosaicEnabled) return;

      const now = Date.now();
      if (now - lastContextMenuTime < doubleClickThreshold && lastContextMenuTarget === mosaicElement) {
          deleteSelectedMosaic(mosaicElement);
          lastContextMenuTime = 0;
          lastContextMenuTarget = null;
      } else {
          selectMosaic(mosaicElement);
          lastContextMenuTime = now;
          lastContextMenuTarget = mosaicElement;
      }
  });

  document.body.appendChild(mosaicElement);
  mosaicElements.push(mosaicElement); // 管理配列に追加

  return mosaicElement; // 作成した要素を返す
}

// --- モザイク選択関連 ---
function selectMosaic(mosaicElement) {
    if (!isMosaicEnabled) return;

    // 既に選択されているものがあれば解除
    deselectMosaic();

    selectedMosaicElement = mosaicElement;
    selectedMosaicElement.style.border = '2px solid blue';
    selectedMosaicElement.querySelectorAll('.resize-handle').forEach(handle => {
        handle.style.display = 'block';
    });
    // ここでのタイマーリセットは不要
}

function deselectMosaic() {
    if (selectedMosaicElement) {
        selectedMosaicElement.style.border = 'none'; // 選択解除
        // リサイズハンドルを非表示
        selectedMosaicElement.querySelectorAll('.resize-handle').forEach(handle => {
            handle.style.display = 'none';
        });
        selectedMosaicElement = null;
    }
}

// --- モザイク移動関連 ---
function startMosaicDrag(e, mosaicElement) {
    if (isResizingMosaic) return; // リサイズ中は移動しない
    isDraggingMosaic = true;
    selectedMosaicElement = mosaicElement; // ドラッグ対象を選択状態にする
    const rect = mosaicElement.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    document.body.style.cursor = 'move'; // ドラッグ中はボディカーソルもmoveに
}

function dragMosaic(e) {
    if (!isDraggingMosaic || !selectedMosaicElement) return;
    const newX = e.clientX - dragOffsetX + window.scrollX;
    const newY = e.clientY - dragOffsetY + window.scrollY;
    selectedMosaicElement.style.left = `${newX}px`;
    selectedMosaicElement.style.top = `${newY}px`;
}

function stopMosaicDrag() {
    isDraggingMosaic = false;
    updateBodyCursor();
    saveMosaicsToStorage(); // ★★★ 変更を保存 ★★★
}

// --- モザイク削除関連 ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedMosaic();
    }
});

function deleteSelectedMosaic(elementToDelete = null) {
    const targetElement = elementToDelete || selectedMosaicElement; // 引数がなければ選択中のものを対象とする

    if (targetElement && isMosaicEnabled) {
        const index = mosaicElements.findIndex(el => el.dataset.mosaicId === targetElement.dataset.mosaicId); // IDで検索
        if (index > -1) {
            mosaicElements.splice(index, 1);
        }
        targetElement.remove();

        // 削除した要素が選択中のものと同じであれば選択解除
        if (targetElement === selectedMosaicElement) {
            selectedMosaicElement = null;
        }
        updateBodyCursor();
        saveMosaicsToStorage(); // ★★★ 変更を保存 ★★★
    }
}

// --- モザイク リサイズ関連 ---
function startResize(e, dir, mosaicElement) {
    if (isDraggingMosaic) return; // 移動中はリサイズしない
    isResizingMosaic = true;
    resizeDirection = dir;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    initialMosaicRect = mosaicElement.getBoundingClientRect();
    // リサイズ中はボディカーソルをリサイズ方向に合わせる（より良いUXのため）
    document.body.style.cursor = getComputedStyle(e.target).cursor;
}

function resizeMosaic(e) {
    if (!isResizingMosaic || !selectedMosaicElement) return;

    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;

    let newLeft = initialMosaicRect.left + window.scrollX;
    let newTop = initialMosaicRect.top + window.scrollY;
    let newWidth = initialMosaicRect.width;
    let newHeight = initialMosaicRect.height;

    if (resizeDirection.includes('w')) {
        newWidth -= dx;
        newLeft += dx;
    }
    if (resizeDirection.includes('e')) {
        newWidth += dx;
    }
    if (resizeDirection.includes('n')) {
        newHeight -= dy;
        newTop += dy;
    }
    if (resizeDirection.includes('s')) {
        newHeight += dy;
    }

    // 最小サイズの制限 (例: 10px)
    const minSize = 10;
    if (newWidth < minSize) {
        if (resizeDirection.includes('w')) {
            newLeft = newLeft + newWidth - minSize;
        }
        newWidth = minSize;
    }
    if (newHeight < minSize) {
        if (resizeDirection.includes('n')) {
            newTop = newTop + newHeight - minSize;
        }
        newHeight = minSize;
    }

    selectedMosaicElement.style.left = `${newLeft}px`;
    selectedMosaicElement.style.top = `${newTop}px`;
    selectedMosaicElement.style.width = `${newWidth}px`;
    selectedMosaicElement.style.height = `${newHeight}px`;
}

function stopResize() {
    isResizingMosaic = false;
    resizeDirection = null;
    initialMosaicRect = null;
    updateBodyCursor(); // ボディカーソルを元に戻す
    saveMosaicsToStorage(); // ★★★ 変更を保存 ★★★
}


// 初期化時にカーソルを設定
updateBodyCursor();

// --- 保存機能関連 ---

// 現在表示されているモザイクのデータを取得する関数 (プリセット保存用)
function getCurrentMosaicsData() {
    return mosaicElements.map(el => {
        const rect = el.getBoundingClientRect();
        // getBoundingClientRect はスクロール位置を考慮しないビューポート相対座標を返すため、
        // スクロール量を加算してページ全体の絶対座標にする
        return {
            id: el.dataset.mosaicId,
            left: rect.left + window.scrollX,
            top: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
        };
    });
}

// ストレージからモザイク情報を読み込み描画する関数
async function loadMosaicsFromStorage(initialStorageKey) {
  let storageKey = initialStorageKey;
  console.log(`loadMosaicsFromStorage: Called with initial key: ${initialStorageKey}`);

  // ★★★ 渡されたキーがYouTubeの動画URLの場合、チャンネルキーへの置き換えを試みる (リトライあり) ★★★
  try {
    const initialUrl = new URL(initialStorageKey);
    if ((initialUrl.hostname === 'www.youtube.com' || initialUrl.hostname === 'youtube.com' || initialUrl.hostname === 'm.youtube.com') && initialUrl.pathname.startsWith('/watch')) {
      console.log(`loadMosaicsFromStorage: Initial key ${initialStorageKey} is a YouTube /watch page. Attempting to get channel key.`);
      
      let channelInfo = getChannelInfoFromYouTubePage(); // 初回試行

      if (!channelInfo) {
        console.log("loadMosaicsFromStorage: Channel info not found on first attempt. Starting retries...");
        const maxRetries = 3;
        const retryDelay = 750; // ミリ秒
        for (let i = 0; i < maxRetries; i++) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          console.log(`loadMosaicsFromStorage: Retrying to get channel info (attempt ${i + 1}/${maxRetries}) for ${initialStorageKey}`);
          channelInfo = getChannelInfoFromYouTubePage();
          if (channelInfo) {
            console.log(`loadMosaicsFromStorage: Channel info found on retry (attempt ${i + 1}).`);
            break;
          }
        }
      }

      if (channelInfo) {
        let determinedChannelKey;
        if (channelInfo.type === 'id') {
          determinedChannelKey = `youtube.com/channel/${channelInfo.value}`;
        } else if (channelInfo.type === 'handle') {
          determinedChannelKey = `youtube.com/${channelInfo.value}`;
        }
        if (determinedChannelKey) {
          console.log(`loadMosaicsFromStorage: Channel key determined: ${determinedChannelKey}. Using this instead of ${initialStorageKey}.`);
          storageKey = determinedChannelKey; // キーをチャンネル共通キーに置き換え
        } else {
          // このケースは channelInfo が真だがキーを形成できなかった場合 (通常は起こらないはず)
          console.warn(`loadMosaicsFromStorage: Channel info was present but failed to form a key. Using initial key: ${initialStorageKey}`);
        }
      } else {
        console.warn(`loadMosaicsFromStorage: Channel info NOT found after retries for ${initialStorageKey}. Using initial key (full URL).`);
      }
    }
  } catch (e) {
    // initialStorageKey が不正なURLだった場合など。そのまま進む。
    console.warn(`loadMosaicsFromStorage: Error processing initial key ${initialStorageKey} for potential channel key replacement.`, e);
  }
  // ★★★ ここまでがキー置き換え処理 ★★★

  clearAllMosaics(); // まず既存のモザイクをクリア

  try {
    const data = await chrome.storage.local.get(storageKey);
    const storageData = data[storageKey]; 
    console.log("Loaded storage data for key", storageKey, ":", storageData);

    // --- データ構造の判定と移行 ---
    let activePresetName = 'デフォルト'; // デフォルトのプリセット名
    let presets = {}; // プリセットデータを格納するオブジェクト

    if (storageData && typeof storageData === 'object' && storageData.presets) {
        // ★ 新しいデータ構造の場合
        presets = storageData.presets;
        activePresetName = storageData.activePreset || Object.keys(presets)[0] || 'デフォルト'; // 保存されたアクティブプリセット > 最初のプリセット > デフォルト

        // アクティブプリセットが presets の中に存在するか確認
        if (!presets[activePresetName]) {
            // 存在しない場合（削除された等）、利用可能な最初のプリセットをアクティブにする
            const availablePresets = Object.keys(presets);
            if (availablePresets.length > 0) {
                activePresetName = availablePresets[0];
                // activePresetを更新する必要があるかもしれないが、ここでは読み込みのみ
                console.warn(`Active preset "${storageData.activePreset}" not found. Using "${activePresetName}" instead.`);
                 // ストレージの activePreset も更新しておく
                await updateActivePreset(storageKey, activePresetName);
            } else {
                // 利用可能なプリセットもない場合、デフォルトを作成
                activePresetName = 'デフォルト';
                presets = { [activePresetName]: [] };
                // 新しいデフォルト状態で保存し直す
                await chrome.storage.local.set({ [storageKey]: { activePreset: activePresetName, presets: presets } });
                console.log("No presets found. Created default preset for", storageKey);
            }
        }

    } else if (Array.isArray(storageData)) {
        // ★ 古いデータ構造の場合、デフォルトプリセットとして移行
        console.log("Migrating old data structure for", storageKey);
        activePresetName = 'デフォルト';
        presets = { [activePresetName]: storageData };
        // 新しい構造で保存し直す
        await chrome.storage.local.set({ [storageKey]: { activePreset: activePresetName, presets: presets } });
        console.log("Migrated data saved for", storageKey);
    } else {
         // ★ データが全くない場合、空のデフォルトプリセットを作成して保存
         activePresetName = 'デフォルト';
         presets = { [activePresetName]: [] };
         await chrome.storage.local.set({ [storageKey]: { activePreset: activePresetName, presets: presets } });
         console.log("No data found. Created default preset structure for", storageKey);
    }
    // --- データ構造の判定と移行ここまで ---


    // 読み込むべきモザイクデータを取得
    const mosaicsToLoad = presets[activePresetName] || [];
    console.log(`Loading preset: ${activePresetName} for ${storageKey}`, mosaicsToLoad);

    if (mosaicsToLoad.length > 0) {
      mosaicsToLoad.forEach(mosaicData => {
        // ★★★ createMosaicElement を使用して描画 ★★★
        createMosaicElement(
          mosaicData.id,
          mosaicData.left,
          mosaicData.top,
          mosaicData.width,
          mosaicData.height
        );
      });
    }
    // 読み込み時には activePreset の保存は不要（既に保存されているか、移行時に保存されるため）

  } catch (error) {
    console.error("Error loading mosaics from storage:", error);
  }
}

// 現在のモザイク情報をストレージに保存する関数 (現在のアクティブなプリセットに対して)
async function saveMosaicsToStorage() {
  const storageKey = getMyStorageKey();
  // ★★★ mosaicElements 配列からデータを生成 ★★★
  const currentMosaicsData = getCurrentMosaicsData(); // 関数 getCurrentMosaicsData を使う

  try {
    const data = await chrome.storage.local.get(storageKey);
    let storageData = data[storageKey];

    // --- 現在のプリセット情報を取得（なければ初期化） ---
    let activePresetName = 'デフォルト';
    let presets = { 'デフォルト': [] }; // デフォルトの構造

    if (storageData && typeof storageData === 'object' && storageData.presets) {
      // 既存のデータ構造を使用
      activePresetName = storageData.activePreset || Object.keys(storageData.presets)[0] || 'デフォルト';
      presets = storageData.presets;
      // アクティブプリセットがpresets内に存在しない場合（稀なケースだが）、作成する
       if (!presets[activePresetName]) {
            console.warn(`Active preset "${activePresetName}" did not exist in presets. Creating it.`);
            presets[activePresetName] = [];
       }
    } else if (Array.isArray(storageData)) {
        // 古いデータ構造からの移行（この関数が呼ばれる前に load で移行されているはずだが念のため）
        console.warn("saveMosaicsToStorage called with old data structure. Migrating.");
        activePresetName = 'デフォルト';
        presets = { [activePresetName]: storageData };
    } else {
        // データが全くない場合（loadで初期化されているはずだが念のため）
        console.warn("saveMosaicsToStorage called with no pre-existing data. Initializing.");
        activePresetName = 'デフォルト';
        presets = { [activePresetName]: [] };
    }
    // --- 現在のプリセット情報取得ここまで ---


    // 現在のモザイクデータをアクティブなプリセットに上書き
    presets[activePresetName] = currentMosaicsData;

    // 保存するデータ全体を構築
    const newData = {
        activePreset: activePresetName,
        presets: presets
    };

    await chrome.storage.local.set({ [storageKey]: newData });
    console.log(`Mosaics saved for ${storageKey} (Preset: ${activePresetName}):`, currentMosaicsData);

  } catch (error) {
    console.error("Error saving mosaics to storage:", error);
  }
}

// ★★★ activePreset のみを更新するヘルパー関数（popup.jsからの切り替え時に使用）★★★
async function updateActivePreset(storageKey, presetName) {
    try {
        const data = await chrome.storage.local.get(storageKey);
        let storageData = data[storageKey];
        // データが存在し、新しい形式であることを確認
        if (storageData && typeof storageData === 'object' && storageData.presets) {
             // 更新対象のプリセット名が実際に存在することも確認
             if (storageData.presets[presetName]) {
                storageData.activePreset = presetName;
                await chrome.storage.local.set({ [storageKey]: storageData });
                console.log(`Active preset updated to ${presetName} for ${storageKey}`);
            } else {
                 console.error(`Cannot update active preset for ${storageKey}: Preset "${presetName}" does not exist.`);
            }
        } else {
            console.error(`Cannot update active preset for ${storageKey}: Invalid or non-existent data structure.`);
            // データ構造がない場合、ここで初期化して設定することも可能だが、
            // 通常は loadMosaicsFromStorage が先に呼ばれて初期化しているはず
        }
    } catch (error) {
        console.error("Error updating active preset:", error);
    }
}

// すべてのモザイクを削除する関数
function clearAllMosaics() {
  // ★★★ クラス名で要素を取得し削除 ★★★
  const existingMosaicElements = document.querySelectorAll('.mosaic-element');
  existingMosaicElements.forEach(el => el.remove());
  // ★★★ 管理配列もクリア ★★★
  mosaicElements = [];
  console.log("Cleared all mosaics and internal array");
}

// --- 初期読み込み ---
// content.js が読み込まれたときに現在のURLのモザイクを読み込む
// service-workerからのメッセージ受信と重複する可能性があるが、
// loadMosaicsFromStorage内でクリア処理を行っているので大きな問題はない想定
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // DOMが既に読み込まれている場合
    const initialKey = getMyStorageKey();
    console.log("Initial load for key (DOM ready):", initialKey);
    loadMosaicsFromStorage(initialKey);
} else {
    // DOM読み込み完了を待つ
    document.addEventListener('DOMContentLoaded', () => {
        const initialKey = getMyStorageKey();
        console.log("Initial load for key (DOMContentLoaded):", initialKey);
        loadMosaicsFromStorage(initialKey);
    });
}

// --- ここまで修正 --- 
