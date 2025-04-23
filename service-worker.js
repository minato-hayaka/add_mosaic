// service-worker.js
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ページの読み込みが完了し、かつURLが存在する場合
  if (changeInfo.status === 'complete' && tab.url) {
    // content scriptにメッセージを送信
    chrome.tabs.sendMessage(tabId, { action: "loadMosaics", url: tab.url })
      .catch(error => {
        // content scriptが挿入されていない場合などのエラーをハンドル
        // (例: chrome:// や file:// などのページ)
        if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
          // console.log(`Content script not available on ${tab.url}`);
        } else {
          console.error("Failed to send message:", error);
        }
      });
  }
}); 
