// This script runs in the background of the extension.

let allImagesFromTabs = []; // To store images collected from all tabs.

// Listener for messages from popup.js or content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "searchAllTabsForImages") {
        allImagesFromTabs = []; // Clear previous results

        // Query all tabs in the current window
        chrome.tabs.query({currentWindow: true}, (tabs) => {
            let pendingResponses = tabs.length;
            if (pendingResponses === 0) {
                sendResponse({ status: "done", images: [] });
                return;
            }

            tabs.forEach(tab => {
                // Skip special Chrome pages (e.g., chrome://*, chrome-extension://*)
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    pendingResponses--;
                    if (pendingResponses === 0) {
                        sendResponse({ status: "done", images: allImagesFromTabs });
                    }
                    return;
                }

                // Inject content script into each tab
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error(`Error injecting content script into tab ${tab.id}:`, chrome.runtime.lastError.message);
                        pendingResponses--;
                        if (pendingResponses === 0) {
                            sendResponse({ status: "done", images: allImagesFromTabs });
                        }
                        return;
                    }

                    // Send message to content script in this tab to get images
                    chrome.tabs.sendMessage(tab.id, { action: "getImagesFromTab" }, (response) => {
                        pendingResponses--;
                        if (chrome.runtime.lastError) {
                            console.warn(`Could not get images from tab ${tab.id}:`, chrome.runtime.lastError.message);
                        } else if (response && response.images && response.images.length > 0) {
                            // Add images to our collection, making sure to avoid duplicates across tabs
                            response.images.forEach(imgData => {
                                // Simple deduplication: add if URL not already present
                                if (!allImagesFromTabs.some(existingImg => existingImg.url === imgData.url)) {
                                    allImagesFromTabs.push(imgData);
                                }
                            });
                        }

                        // If all tabs have responded, send combined results back to popup
                        if (pendingResponses === 0) {
                            sendResponse({ status: "done", images: allImagesFromTabs });
                        }
                    });
                });
            });
        });
        // Indicate that the response will be sent asynchronously
        return true;
    }
});