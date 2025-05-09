const toggleSwitch = document.getElementById('toggleSwitch');
const savedMosaicsList = document.getElementById('saved-mosaics-list');
const noSavedDataElement = document.getElementById('no-saved-data');

// ★★★ プリセットUI要素を取得 ★★★
const presetControls = document.getElementById('preset-controls');
const presetSelect = document.getElementById('preset-select');
const deletePresetButton = document.getElementById('delete-preset-button');
const newPresetNameInput = document.getElementById('new-preset-name');
const saveCurrentButton = document.getElementById('save-current-button');
const presetMessage = document.getElementById('preset-message');
// const addPresetButton = document.getElementById('add-preset-button');

let currentTabStorageKey = null; // ★★★ 現在のタブで使用するストレージキー ★★★
let isLoadingPresets = false; // プリセット読み込み中のフラグ

// --- 初期処理 ---

// 保存されたON/OFF状態を読み込む
chrome.storage.sync.get('isEnabled', (data) => {
  toggleSwitch.checked = data.isEnabled || false;
});

// ★★★ アクティブタブのURLを取得し、プリセットUIを初期化する関数 ★★★
async function initializePresetUI() {
    // 既に読み込み中なら何もしない
    if (isLoadingPresets) return;
    isLoadingPresets = true;
    presetControls.style.display = 'none'; // 一旦隠す
    presetMessage.textContent = '読み込み中...';

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].id && tabs[0].url && (tabs[0].url.startsWith('http://') || tabs[0].url.startsWith('https://'))) {
            // currentTabUrl = tabs[0].url; // 古いロジック
            // content.jsに現在のストレージキーを問い合わせる
            try {
                const response = await chrome.tabs.sendMessage(tabs[0].id, { action: "getMyStorageKey" });
                if (response && response.storageKey) {
                    currentTabStorageKey = response.storageKey;
                    console.log("Received storageKey from content.js:", currentTabStorageKey);
                    await loadPresetsForCurrentTab(); // プリセットを読み込んで表示
                    presetControls.style.display = 'block'; // UI表示
                    presetMessage.textContent = ''; // メッセージクリア
                } else {
                    console.error("Failed to get storageKey from content.js or invalid response:", response);
                    currentTabStorageKey = null;
                    presetMessage.textContent = '現在のタブの情報を取得できませんでした。ページを再読み込みしてみてください。';
                }
            } catch (e) {
                console.error("Error sending getMyStorageKey to content.js:", e);
                currentTabStorageKey = null;
                if (e.message.includes("Could not establish connection") || e.message.includes("Receiving end does not exist")) {
                    presetMessage.textContent = 'ページ内のスクリプトに接続できません。ページをリロードするか、拡張機能の権限を確認してください。';
                } else {
                    presetMessage.textContent = '現在のタブの情報取得中にエラーが発生しました。';
                }
            }
        } else {
            currentTabStorageKey = null;
            presetMessage.textContent = '現在のタブではプリセットを利用できません。';
        }
    } catch (error) {
        console.error('Error initializing preset UI:', error);
        currentTabStorageKey = null;
        presetMessage.textContent = 'プリセットUIの初期化に失敗しました。';
    } finally {
        isLoadingPresets = false;
    }
}

// ★★★ 現在のタブのプリセットを読み込み、Select要素を更新する関数 ★★★
async function loadPresetsForCurrentTab() {
    if (!currentTabStorageKey) return;

    presetSelect.innerHTML = ''; // Selectをクリア
    presetSelect.disabled = true; // 読み込み中は無効化
    deletePresetButton.disabled = true;

    try {
        const data = await chrome.storage.local.get(currentTabStorageKey);
        const storageData = data[currentTabStorageKey];

        let activePresetName = 'デフォルト';
        let presets = { 'デフォルト': [] }; // デフォルト構造

        if (storageData && typeof storageData === 'object' && storageData.presets) {
            presets = storageData.presets;
            activePresetName = storageData.activePreset || Object.keys(presets)[0] || 'デフォルト';
            if (Object.keys(presets).length === 0) {
                presets = { 'デフォルト': [] };
                activePresetName = 'デフォルト';
            } else {
                if (!presets[activePresetName]) {
                    activePresetName = Object.keys(presets)[0];
                }
            }
        } else if (Array.isArray(storageData)) {
             presets = { 'デフォルト': storageData };
             activePresetName = 'デフォルト';
        } 

        const presetNames = Object.keys(presets);
        if (presetNames.length === 0) {
             presetNames.push('デフォルト');
             presets['デフォルト'] = [];
             activePresetName = 'デフォルト';
        }

        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === activePresetName) {
                option.selected = true;
            }
            presetSelect.appendChild(option);
        });

        presetSelect.disabled = false; // 読み込み完了で有効化
        updateDeleteButtonState(); // 削除ボタンの状態更新

    } catch (error) {
        console.error(`Error loading presets for key ${currentTabStorageKey}:`, error);
        presetMessage.textContent = 'プリセットの読み込みに失敗しました。';
        presetSelect.innerHTML = '<option value="デフォルト">デフォルト</option>';
        presetSelect.disabled = true;
        deletePresetButton.disabled = true;
    }
}

// ★★★ 削除ボタンの状態を更新 (プリセットが1つの場合は無効化) ★★★
function updateDeleteButtonState() {
    deletePresetButton.disabled = presetSelect.options.length <= 1 || presetSelect.disabled;
}

// 保存されたモザイクリストを読み込んで表示する関数 (全URL対象)
function loadSavedMosaics() {
  chrome.storage.local.get(null, (items) => {
    // リストをクリア
    savedMosaicsList.innerHTML = '';

    // const urls = Object.keys(items).filter(url => url.startsWith('http://') || url.startsWith('https://'));
    const storageKeys = Object.keys(items).filter(key =>
        key.startsWith('http://') ||
        key.startsWith('https://') ||
        key.startsWith('youtube.com/channel/') ||
        key.startsWith('youtube.com/@')
    );


    if (storageKeys.length === 0) {
        noSavedDataElement.style.display = 'block'; // データがないメッセージを表示
        return;
    } else {
        noSavedDataElement.style.display = 'none'; // データがあるのでメッセージを隠す
    }

    storageKeys.forEach((key) => {
      const mosaicDataContainer = items[key];
      let displayInfo = "";
      let mosaicsExist = false;

      if (mosaicDataContainer && typeof mosaicDataContainer === 'object' && mosaicDataContainer.presets) {
        // 新しいデータ構造
        const presets = mosaicDataContainer.presets;
        const presetNames = Object.keys(presets);

        if (presetNames.length > 0) {
          // いずれかのプリセットにモザイクが1つ以上含まれているか
          if (presetNames.some(name => Array.isArray(presets[name]) && presets[name].length > 0)) {
            mosaicsExist = true;
            const activePresetName = mosaicDataContainer.activePreset;
            if (activePresetName && presets[activePresetName] && presets[activePresetName].length > 0) {
              displayInfo = `(アクティブ: ${presets[activePresetName].length}個)`;
            } else {
              // アクティブなものがないか空なら、存在する最初の0個でないプリセットの情報を出す
              const firstPopulatedPresetName = presetNames.find(name => presets[name] && presets[name].length > 0);
              if (firstPopulatedPresetName) {
                displayInfo = `(${presetNames.length}プリセット, ${presets[firstPopulatedPresetName].length}個等)`;
              } else {
                // このケースは mosaicsExist = true の条件から通常到達しないが念のため
                displayInfo = `(${presetNames.length}プリセット)`;
              }
            }
          }
        }
      } else if (Array.isArray(mosaicDataContainer)) {
        // 古いデータ構造
        if (mosaicDataContainer.length > 0) {
          mosaicsExist = true;
          displayInfo = `(${mosaicDataContainer.length}個)`;
        }
      }

      if (mosaicsExist) {
          const listItem = document.createElement('li');

          const urlSpan = document.createElement('span');
          urlSpan.classList.add('url-text');
          
          let displayKeyText = key;
          if (key.startsWith('youtube.com/channel/')) {
              displayKeyText = `YouTubeチャンネル (ID: ${key.substring('youtube.com/channel/'.length)})`;
          } else if (key.startsWith('youtube.com/@')) {
              displayKeyText = `YouTubeチャンネル (${key.substring('youtube.com/'.length)})`;
          } else {
              try {
                  const u = new URL(key);
                  displayKeyText = u.hostname + (u.pathname.length > 1 && u.pathname !== '/' ? u.pathname.substring(0,20)+'...' : '');
              } catch (e) { /* use key as is if URL parsing fails */ }
          }
          urlSpan.textContent = `${displayKeyText} ${displayInfo}`;
          urlSpan.title = key; // ホバーでフルキー表示

          const deleteButton = document.createElement('button');
          deleteButton.classList.add('delete-button');
          deleteButton.textContent = '削除';
          deleteButton.dataset.storageKey = key; // ★★★ 削除対象のキーをボタンに紐付け ★★★

          deleteButton.addEventListener('click', (e) => {
            handleDelete(e.target.dataset.storageKey, listItem);
          });

          listItem.appendChild(urlSpan);
          listItem.appendChild(deleteButton);
          savedMosaicsList.appendChild(listItem);
      }
    });
  });
}

// 削除ボタンがクリックされたときの処理 (全URL対象)
function handleDelete(storageKey, listItem) { // ★★★ 引数を storageKey に変更 ★★★
    let confirmMessageKeyText = storageKey;
    if (storageKey.startsWith('youtube.com/channel/')) {
        confirmMessageKeyText = `YouTubeチャンネル (ID: ${storageKey.substring('youtube.com/channel/'.length)})`;
    } else if (storageKey.startsWith('youtube.com/@')) {
        confirmMessageKeyText = `YouTubeチャンネル (${storageKey.substring('youtube.com/'.length)})`;
    } else {
        try { confirmMessageKeyText = new URL(storageKey).hostname; } catch(e){}
    }

    if (!confirm(`${confirmMessageKeyText} に保存された全てのプリセットを削除しますか？`)) {
        return;
    }
    chrome.storage.local.remove(storageKey, async () => {
        if (chrome.runtime.lastError) {
            console.error(`Error removing data for ${storageKey}:`, chrome.runtime.lastError);
            presetMessage.textContent = `${confirmMessageKeyText} のデータ削除に失敗しました。`;
        } else {
            console.log(`Data for ${storageKey} removed.`);
            presetMessage.textContent = ''; // エラーメッセージをクリア
            loadSavedMosaics(); // リストを再読み込みして表示を更新
            // ★★★ 現在のタブが削除されたキーと一致する場合、content.jsにモザイククリアを指示 ★★★
            // content.js側が自身のキーと比較するため、削除されたstorageKeyを渡す
            if (currentTabStorageKey === storageKey) { // ポップアップが知っている現在のキーと一致したら
                try {
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tabs[0] && tabs[0].id) {
                        await chrome.tabs.sendMessage(tabs[0].id, { action: "clearMosaicsIfMatch", url: storageKey }); // urlパラメータにキーを渡す
                        console.log(`Sent clearMosaicsIfMatch message to content script for key ${storageKey}`);
                    }
                } catch (error) {
                    console.error("Error sending clearMosaicsIfMatch message:", error);
                }
            }
        }
    });
}


// --- イベントリスナー ---

// トグルスイッチの状態変更
toggleSwitch.addEventListener('change', () => {
  const isEnabled = toggleSwitch.checked;
  chrome.storage.sync.set({ isEnabled });

  // content.js にメッセージを送信
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_MOSAIC', payload: isEnabled });
    } else {
      console.error('アクティブなタブが見つかりません。');
    }
  });
});

// ★★★ プリセット選択変更時の処理 ★★★
presetSelect.addEventListener('change', async () => {
    if (!currentTabStorageKey || presetSelect.disabled) return;
    const selectedPresetName = presetSelect.value;
    presetMessage.textContent = `プリセット「${selectedPresetName}」を読み込み中...`;
    presetSelect.disabled = true; // 処理中は無効化
    deletePresetButton.disabled = true;

    try {
        // 1. content.js にプリセット切り替えを指示
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].id) {
            // sendMessage の応答を受け取る
            const response = await chrome.tabs.sendMessage(tabs[0].id, { action: "switchPreset", presetName: selectedPresetName });
            console.log(`Received response from content script for switchPreset:`, response);

            // 応答をチェック
            if (response && response.success) {
                console.log(`Successfully switched preset to ${selectedPresetName} in content script.`);
                presetMessage.textContent = `プリセット「${selectedPresetName}」を読み込みました。`;
                 // 念のため、ストレージの activePreset が実際に変わったか確認し、UIに再反映する
                 // (content.js側で更新されているはずだが、同期のため)
                 // UI更新は finally ブロックの外で行う
            } else {
                 // content.js からエラーが返ってきた場合
                 console.error("Content script reported failure switching preset:", response?.error);
                 presetMessage.textContent = `プリセットの切り替えに失敗しました: ${response?.error || '不明なエラー'}`;
                 // UIを選択前の状態に戻す処理は finally の後に loadPresetsForCurrentTab で行う
            }
        } else {
             presetMessage.textContent = 'アクティブなタブに接続できませんでした。';
             // UIを選択前の状態に戻す処理は finally の後に loadPresetsForCurrentTab で行う
        }
    } catch (error) { // sendMessage自体が失敗した場合 (接続エラーなど)
        console.error('Error switching preset (sendMessage failed):', error);
        if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
             presetMessage.textContent = 'タブ内のスクリプトに接続できません。ページをリロードしてください。';
        } else {
            presetMessage.textContent = 'プリセットの切り替え中に通信エラーが発生しました。';
        }
         // UIを選択前の状態に戻す処理は finally の後に loadPresetsForCurrentTab で行う
    } finally {
        // 状態に関わらず最後にUIを有効化し、リストを再読み込みして同期
        presetSelect.disabled = false;
        // loadPresetsForCurrentTab を呼ぶことで delete ボタンの状態も更新される
        await loadPresetsForCurrentTab();
    }
});


// ★★★ プリセット削除ボタンの処理 ★★★
deletePresetButton.addEventListener('click', async () => {
    if (!currentTabStorageKey || presetSelect.options.length <= 1 || deletePresetButton.disabled) return;

    const presetNameToDelete = presetSelect.value;
    let keyIdentifier = currentTabStorageKey;
    try { keyIdentifier = new URL(currentTabStorageKey).hostname; } catch(e) {}
    if (currentTabStorageKey.startsWith('youtube.com/')) {
        keyIdentifier = currentTabStorageKey.substring('youtube.com/'.length);
        if (keyIdentifier.startsWith('channel/')) {
            keyIdentifier = `チャンネルID: ${keyIdentifier.substring('channel/'.length)}`;
        } else {
            keyIdentifier = `チャンネル: ${keyIdentifier}`;
        }
    }

    if (!confirm(`現在のタブ(${keyIdentifier})のプリセット「${presetNameToDelete}」を削除しますか？`)) {
        return;
    }

    presetMessage.textContent = `プリセット「${presetNameToDelete}」を削除中...`;
    presetSelect.disabled = true; // 処理中は無効化
    deletePresetButton.disabled = true;

    try {
        const data = await chrome.storage.local.get(currentTabStorageKey);
        let storageData = data[currentTabStorageKey];

        if (storageData && typeof storageData === 'object' && storageData.presets) {
            if (storageData.presets[presetNameToDelete]) {
                delete storageData.presets[presetNameToDelete]; // プリセットを削除
                console.log(`Preset "${presetNameToDelete}" deleted locally for ${currentTabStorageKey}`);

                let newActivePresetName = storageData.activePreset;
                if (storageData.activePreset === presetNameToDelete) {
                    const remainingPresets = Object.keys(storageData.presets);
                    newActivePresetName = remainingPresets.length > 0 ? remainingPresets[0] : 'デフォルト';
                     if (remainingPresets.length === 0) {
                         storageData.presets['デフォルト'] = [];
                         newActivePresetName = 'デフォルト';
                         console.log("Last preset deleted, created default preset.");
                     }
                    storageData.activePreset = newActivePresetName; 
                    console.log(`Active preset changed to "${newActivePresetName}"`);
                }

                await chrome.storage.local.set({ [currentTabStorageKey]: storageData });
                console.log(`Storage updated after deleting preset for ${currentTabStorageKey}`);
                presetMessage.textContent = `プリセット「${presetNameToDelete}」を削除しました。`;

                await loadPresetsForCurrentTab();

                if (storageData.activePreset === newActivePresetName) {
                    console.log("Sending switchPreset to content script with new active preset:", newActivePresetName);
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tabs[0] && tabs[0].id) {
                         await chrome.tabs.sendMessage(tabs[0].id, { action: "switchPreset", presetName: newActivePresetName });
                    } else {
                         console.warn("Could not send switchPreset message after delete: No active tab found.");
                    }
                }

            } else {
                console.error("Preset to delete not found in storage data:", presetNameToDelete);
                presetMessage.textContent = '削除対象のプリセットが見つかりません。リロードしてください。';
                await loadPresetsForCurrentTab(); // UIを同期
            }
        } else {
             console.error("Invalid storage data structure found when trying to delete preset.");
             presetMessage.textContent = 'プリセットデータの読み込みに失敗しました。';
             // UIを同期
             await loadPresetsForCurrentTab();
        }
    } catch (error) {
        console.error('Error deleting preset:', error);
        presetMessage.textContent = 'プリセットの削除に失敗しました。';
        // エラー時もUIを同期
        await loadPresetsForCurrentTab();
    } finally {
        // loadPresetsForCurrentTab内でボタンの状態は更新されるが念のため
        presetSelect.disabled = false;
        updateDeleteButtonState();
    }
});

// ★★★ 現在のモザイクを新しいプリセットとして保存するボタンの処理 ★★★
saveCurrentButton.addEventListener('click', async () => {
    if (!currentTabStorageKey) return;
    const newPresetName = newPresetNameInput.value.trim();
    if (!newPresetName) {
        presetMessage.textContent = 'プリセット名を入力してください。';
        newPresetNameInput.focus();
        return;
    }

    // '削除' ボタンと同じスタイルにするなどして、処理中を示す
    saveCurrentButton.disabled = true;
    saveCurrentButton.textContent = '保存中...';
    presetMessage.textContent = `現在の状態を「${newPresetName}」として保存中...`;
    presetSelect.disabled = true;
    deletePresetButton.disabled = true;

    try {
        // 1. content.js から現在のモザイク情報を取得
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].id) {
            presetMessage.textContent = 'アクティブなタブが見つかりません。';
            throw new Error('Active tab not found');
        }

        let response;
        try {
             response = await chrome.tabs.sendMessage(tabs[0].id, { action: "getCurrentMosaics" });
        } catch (e) {
             console.error("Error sending message to content script:", e);
              presetMessage.textContent = 'タブ内のスクリプトと通信できません。ページをリロードするか、権限を確認してください。';
             throw new Error('Failed to communicate with content script');
        }

        const currentMosaics = response?.mosaics; // オプショナルチェイニング

        if (!currentMosaics) {
             presetMessage.textContent = '現在のモザイク情報の取得に失敗しました。';
             throw new Error('Failed to get current mosaics');
        }

        // 2. ストレージデータを取得して更新
        const data = await chrome.storage.local.get(currentTabStorageKey);
        let storageData = data[currentTabStorageKey];

        let presets = {};
        let currentActivePreset = 'デフォルト';
        // 既存データがあれば取得、なければ初期化
         if (storageData && typeof storageData === 'object' && storageData.presets) {
             presets = storageData.presets;
             currentActivePreset = storageData.activePreset || Object.keys(presets)[0] || 'デフォルト';
         } else {
             // データがない or 古い形式の場合、新しい構造で初期化
             storageData = { activePreset: 'デフォルト', presets: {'デフォルト': []} };
             presets = storageData.presets;
             currentActivePreset = 'デフォルト';
             console.log("Initialized storage data structure while saving preset.");
         }

        // 新しいプリセット名で上書き（または新規作成）
        const isExistingPreset = presets.hasOwnProperty(newPresetName);
        if (isExistingPreset) {
             if (!confirm(`プリセット「${newPresetName}」は既に存在します。上書きしますか？`)) {
                 presetMessage.textContent = '保存をキャンセルしました。';
                 newPresetNameInput.focus();
                 // UIを元に戻す
                 saveCurrentButton.disabled = false;
                 saveCurrentButton.textContent = '現在の状態を保存';
                 presetSelect.disabled = false;
                 updateDeleteButtonState();
                 return; // キャンセル
             }
        }
        presets[newPresetName] = currentMosaics;
        storageData.presets = presets;
        // 新しく保存したプリセットをアクティブにする
        storageData.activePreset = newPresetName;

        // 3. ストレージに保存
        await chrome.storage.local.set({ [currentTabStorageKey]: storageData });
        console.log(`Saved current mosaics as ${isExistingPreset ? 'overwritten' : 'new'} preset "${newPresetName}" for ${currentTabStorageKey}`);
        presetMessage.textContent = `現在のモザイクを「${newPresetName}」として${isExistingPreset ? '上書き保存' : '保存'}しました。`;
        newPresetNameInput.value = ''; // 入力欄をクリア

        // 4. UIを更新 (新しいプリセットが選択された状態になる)
        await loadPresetsForCurrentTab();

         // 5. content script にも新しいプリセットをロードさせる必要はない
         // なぜなら、content.js は既に保存された状態であり、activePreset もストレージで更新されたため、
         // 次回 loadMosaicsFromStorage が呼ばれた際に新しい状態が読み込まれる。
         // もし即時反映が必要なら switchPreset を送るが、現状は不要。

    } catch (error) {
        console.error('Error saving current mosaics as new preset:', error);
        // エラーメッセージは try 内で設定されている場合があるので、ここでは一般的なメッセージに留めるか、何もしない
        if (!presetMessage.textContent.includes('失敗') && !presetMessage.textContent.includes('キャンセル')) {
             presetMessage.textContent = 'プリセットの保存に失敗しました。';
        }
    } finally {
        // UIを元に戻す
        saveCurrentButton.disabled = false;
        saveCurrentButton.textContent = '現在の状態を保存';
        presetSelect.disabled = false;
        updateDeleteButtonState();
    }
});


// ポップアップが開かれたときにリストとプリセットUIを初期化
document.addEventListener('DOMContentLoaded', () => {
    loadSavedMosaics(); // 全URLリスト読み込み
    initializePresetUI(); // 現在タブのプリセットUI初期化
}); 
