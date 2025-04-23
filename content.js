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

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "loadMosaics") {
    console.log("Received loadMosaics request for:", message.url);
    loadMosaicsFromStorage(message.url);
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
    console.log("Received clearMosaicsIfMatch request for:", message.url);
    // 現在のページのURLと削除対象のURLが一致するか確認
    if (message.url === window.location.href) {
      console.log("URL match found. Clearing mosaics on the current page.");
      clearAllMosaics(); // モザイクをクリア
    } else {
      console.log("URL does not match the current page. No mosaics cleared.");
    }
    // このアクションに対する応答は特に不要なので、true を返さない
  } else if (message.action === "switchPreset") { // ★★★ プリセット切り替え処理を修正 ★★★
    console.log("Received switchPreset request for:", message.presetName);
    (async () => { // 即時実行非同期関数でラップ
        try {
            // 最初にプリセットが存在するか確認 (updateActivePreset内でも確認するが念のため)
            const data = await chrome.storage.local.get(window.location.href);
            const storageData = data[window.location.href];
            if (!storageData?.presets?.[message.presetName]) {
                 // プリセットが存在しない場合はエラーを投げずに警告を出し、処理を中断する
                 console.warn(`Preset "${message.presetName}" not found. Switch aborted.`);
                 sendResponse({ success: false, error: `Preset "${message.presetName}" not found.` });
                 return; // 処理中断
            }

            // プリセットが存在すれば更新・読み込み
            await updateActivePreset(window.location.href, message.presetName);
            // loadMosaicsFromStorage は内部で activePreset を読むので引数不要
            await loadMosaicsFromStorage(window.location.href);
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
  createMosaicElement(newMosaicId, left, top, width, height); // 新しい関数で要素作成

  saveMosaicsToStorage(); // ★★★ 変更を保存 ★★★
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
async function loadMosaicsFromStorage(url) {
  clearAllMosaics(); // まず既存のモザイクをクリア

  try {
    const data = await chrome.storage.local.get(url);
    const storageData = data[url]; // URLに対応するモザイク情報の配列 or オブジェクト
    console.log("Loaded storage data for", url, ":", storageData);

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
                await updateActivePreset(url, activePresetName);
            } else {
                // 利用可能なプリセットもない場合、デフォルトを作成
                activePresetName = 'デフォルト';
                presets = { [activePresetName]: [] };
                // 新しいデフォルト状態で保存し直す
                await chrome.storage.local.set({ [url]: { activePreset: activePresetName, presets: presets } });
                console.log("No presets found. Created default preset for", url);
            }
        }

    } else if (Array.isArray(storageData)) {
        // ★ 古いデータ構造の場合、デフォルトプリセットとして移行
        console.log("Migrating old data structure for", url);
        activePresetName = 'デフォルト';
        presets = { [activePresetName]: storageData };
        // 新しい構造で保存し直す
        await chrome.storage.local.set({ [url]: { activePreset: activePresetName, presets: presets } });
        console.log("Migrated data saved for", url);
    } else {
         // ★ データが全くない場合、空のデフォルトプリセットを作成して保存
         activePresetName = 'デフォルト';
         presets = { [activePresetName]: [] };
         await chrome.storage.local.set({ [url]: { activePreset: activePresetName, presets: presets } });
         console.log("No data found. Created default preset structure for", url);
    }
    // --- データ構造の判定と移行ここまで ---


    // 読み込むべきモザイクデータを取得
    const mosaicsToLoad = presets[activePresetName] || [];
    console.log(`Loading preset: ${activePresetName} for ${url}`, mosaicsToLoad);

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
  const url = window.location.href;
  // ★★★ mosaicElements 配列からデータを生成 ★★★
  const currentMosaicsData = getCurrentMosaicsData(); // 関数 getCurrentMosaicsData を使う

  try {
    const data = await chrome.storage.local.get(url);
    let storageData = data[url];

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

    await chrome.storage.local.set({ [url]: newData });
    console.log(`Mosaics saved for ${url} (Preset: ${activePresetName}):`, currentMosaicsData);

  } catch (error) {
    console.error("Error saving mosaics to storage:", error);
  }
}

// ★★★ activePreset のみを更新するヘルパー関数（popup.jsからの切り替え時に使用）★★★
async function updateActivePreset(url, presetName) {
    try {
        const data = await chrome.storage.local.get(url);
        let storageData = data[url];
        // データが存在し、新しい形式であることを確認
        if (storageData && typeof storageData === 'object' && storageData.presets) {
             // 更新対象のプリセット名が実際に存在することも確認
             if (storageData.presets[presetName]) {
                storageData.activePreset = presetName;
                await chrome.storage.local.set({ [url]: storageData });
                console.log(`Active preset updated to ${presetName} for ${url}`);
            } else {
                 console.error(`Cannot update active preset for ${url}: Preset "${presetName}" does not exist.`);
            }
        } else {
            console.error(`Cannot update active preset for ${url}: Invalid or non-existent data structure.`);
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
    // ★★★ 引数なしで呼び出し ★★★
    loadMosaicsFromStorage(window.location.href);
} else {
    // DOM読み込み完了を待つ
    document.addEventListener('DOMContentLoaded', () => {
        // ★★★ 引数なしで呼び出し ★★★
        loadMosaicsFromStorage(window.location.href);
    });
}

// --- ここまで修正 --- 
