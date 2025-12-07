// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const replacementWordInput = document.getElementById('replacementWord');
    const addReplacementBtn = document.getElementById('addReplacement');
    const replacementsList = document.getElementById('replacementsList');
    const processPageBtn = document.getElementById('processPage');
    const statusDiv = document.getElementById('status');
    const apiKeyInput = document.getElementById('apiKey');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const autoProcessCheckbox = document.getElementById('autoProcess');
    const brainJugCount = document.getElementById('brainJugCount');
    let replacements = [];

    // Constants for animation
    const COUNT_ANIMATION_DURATION = 600; // ms
    const INCREMENT_ANIMATION_CAP = 50;
    let isAnimatingCount = false;

    // Get references to the new elements
    const brainJugCounter = document.getElementById('brainJugCounter');
    const mainCountEl = brainJugCounter.querySelector('.main-count');
    const incrementEl = brainJugCounter.querySelector('.increment');

    // Set ARIA live region for accessibility on the main count
    mainCountEl.setAttribute('aria-live', 'polite');

    // Show status message (inline)
    function showStatus(message, type = 'info') {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'status';
        }, 3000);
    }

    // Update brain jug count display
    function updateBrainJugCount(count, isOfflineMode = false, isNewDay = false) {
        mainCountEl.textContent = count;
        
        // Calculate and update percentage progress
        const goal = 200;
        const percentage = Math.min(100, Math.round((count / goal) * 100));
        const brainJugProgress = document.getElementById('brainJugProgress');
        
        // Create engaging progress message
        let progressMessage;
        if (isOfflineMode) {
            progressMessage = 'Offline mode - viewing saved progress';
        } else if (isNewDay && count === 0) {
            progressMessage = '🌅 New day! Start fresh!';
        } else if (percentage === 0) {
            progressMessage = 'Start your learning journey!';
        } else if (percentage < 25) {
            progressMessage = `Progress: ${percentage}% of daily goal`;
        } else if (percentage < 50) {
            progressMessage = `Keep going! ${percentage}% complete`;
        } else if (percentage < 75) {
            progressMessage = `Halfway there! ${percentage}% done`;
        } else if (percentage < 100) {
            progressMessage = `Almost there! ${percentage}% complete`;
        } else {
            progressMessage = 'Daily goal achieved! 🎉';
        }
        
        brainJugProgress.textContent = progressMessage;
        
        // Add full state styling when count reaches 200
        const brainJugContainer = document.getElementById('brainJugContainer');
        if (count >= 200) {
            brainJugContainer.classList.add('full');
            // Show celebration message if this is the first time reaching 100%
            if (percentage === 100) {
                showStatus('🎉 Daily goal achieved! Great job!', 'success');
            }
        } else {
            brainJugContainer.classList.remove('full');
        }
        
        // Add offline mode styling
        if (isOfflineMode) {
            brainJugContainer.classList.add('offline');
        } else {
            brainJugContainer.classList.remove('offline');
        }

        // Add new day styling
        if (isNewDay) {
            brainJugContainer.classList.add('new-day');
        } else {
            brainJugContainer.classList.remove('new-day');
        }
    }

    // Smooth count-up animation function
    function animateCount(el, from, to, duration = COUNT_ANIMATION_DURATION) {
        if (isAnimatingCount) return; // Prevent overlapping animations
        isAnimatingCount = true;
        let start = null;
        function step(timestamp) {
            if (!start) start = timestamp;
            let progress = Math.min((timestamp - start) / duration, 1);
            let value = Math.floor(from + (to - from) * progress);
            el.textContent = value;
            // Update progress text during animation
            const goal = 200;
            const percentage = Math.min(100, Math.round((value / goal) * 100));
            const brainJugProgress = document.getElementById('brainJugProgress');
            let progressMessage;
            if (percentage === 0) {
                progressMessage = 'Start your learning journey!';
            } else if (percentage < 25) {
                progressMessage = `Progress: ${percentage}% of daily goal`;
            } else if (percentage < 50) {
                progressMessage = `Keep going! ${percentage}% complete`;
            } else if (percentage < 75) {
                progressMessage = `Halfway there! ${percentage}% done`;
            } else if (percentage < 100) {
                progressMessage = `Almost there! ${percentage}% complete`;
            } else {
                progressMessage = 'Daily goal achieved! 🎉';
            }
            brainJugProgress.textContent = progressMessage;
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                isAnimatingCount = false;
            }
        }
        requestAnimationFrame(step);
    }

    // Show increment, animate it, then update main count
    function showIncrementThenUpdate(mainCount, increment, finalCount) {
        // Set main count to the old value, show increment
        mainCountEl.textContent = mainCount;
        incrementEl.textContent = `+${increment}`;
        incrementEl.style.display = '';
        incrementEl.classList.add('show');

        // Remove increment after animation, then update main count
        setTimeout(() => {
            incrementEl.classList.remove('show');
            incrementEl.style.display = 'none';
            // Animate the main count up, or just set it
            animateCount(mainCountEl, mainCount, finalCount);
        }, 900); // match animation duration
    }

    // Show increment then update to total after delay
    function showIncrementThenTotal(currentCount, lastCount) {
        const increment = currentCount - lastCount;
        if (increment > 0) {
            showIncrementThenUpdate(lastCount, increment, currentCount);
            chrome.storage.local.set({ lastJugCount: currentCount });
        } else {
            updateBrainJugCount(currentCount);
        }
    }

    // Check if current tab is on a valid page for content scripts
    async function isValidPageForContentScript() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab.url && 
                   !tab.url.startsWith('chrome://') && 
                   !tab.url.startsWith('about:') && 
                   !tab.url.startsWith('edge://') &&
                   !tab.url.startsWith('moz-extension://') &&
                   !tab.url.startsWith('safari-extension://');
        } catch (error) {
            console.error('Error checking page validity:', error);
            return false;
        }
    }

    // Trigger brain jug animation and update count
    async function triggerBrainJugAnimation() {
        try {
            // Check if we're on a valid page where content scripts can run
            const isValidPage = await isValidPageForContentScript();
            if (!isValidPage) {
                // We're on a restricted page, just load from storage
                const result = await chrome.storage.local.get(['dropsInJug', 'lastResetDate', 'lastJugCount']);
                const count = result.dropsInJug || 0;
                const lastCount = result.lastJugCount || 0;
                const today = new Date().toDateString();
                const isNewDay = result.lastResetDate !== today;
                
                if (isNewDay) {
                    updateBrainJugCount(count, false, isNewDay); // New day - prioritize new day message over offline mode
                    if (count === 0) {
                        showStatus('🌅 New day! Start fresh!', 'info');
                    }
                } else {
                    // On invalid page, show offline mode (no live updates possible)
                    updateBrainJugCount(count, true, false);
                }
                return;
            }
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Try to inject content script first to ensure it's available
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['src/content/content.js']
                });
            } catch (injectionError) {
                // Content script injection failed, use fallback
                const result = await chrome.storage.local.get(['dropsInJug', 'lastResetDate', 'lastJugCount']);
                const count = result.dropsInJug || 0;
                const lastCount = result.lastJugCount || 0;
                const today = new Date().toDateString();
                const isNewDay = result.lastResetDate !== today;
                
                if (isNewDay) {
                    updateBrainJugCount(count, false, isNewDay); // New day - prioritize new day message over offline mode
                    if (count === 0) {
                        showStatus('🌅 New day! Start fresh!', 'info');
                    }
                } else {
                    showIncrementThenTotal(count, lastCount); // Show increment if any
                }
                return;
            }
            
            // Get current count and last count for increment calculation
            const result = await chrome.storage.local.get(['lastJugCount']);
            const lastCount = result.lastJugCount || 0;
            
            const response = await chrome.tabs.sendMessage(tab.id, { command: 'getJugCount' });
            if (response && response.count !== undefined) {
                const currentCount = response.count;
                showIncrementThenTotal(currentCount, lastCount);
                
                // Trigger drop animations if there's an increment
                if (currentCount > lastCount) {
                    const increment = currentCount - lastCount;
                    const dropsToAnimate = Math.min(50, increment);
                    chrome.tabs.sendMessage(tab.id, { 
                        command: 'animateDrops', 
                        count: dropsToAnimate 
                    }).catch(() => {
                        // Ignore errors if content script is not available
                    });
                }
            } else {
                // Content script didn't respond or returned undefined - fall back to storage
                const storageResult = await chrome.storage.local.get(['dropsInJug', 'lastResetDate', 'lastJugCount']);
                const count = storageResult.dropsInJug || 0;
                const lastCount = storageResult.lastJugCount || 0;
                const today = new Date().toDateString();
                const isNewDay = storageResult.lastResetDate !== today;
                
                if (isNewDay) {
                    updateBrainJugCount(count, false, isNewDay); // Don't show offline mode, show new day message
                    if (count === 0) {
                        showStatus('🌅 New day! Start fresh!', 'info');
                    }
                } else {
                    showIncrementThenTotal(count, lastCount);
                }
            }
        } catch (error) {
            // Check if this is an expected connection error
            if (error.message && error.message.includes('Could not establish connection')) {
                // This is expected on pages without content scripts, use fallback silently
                try {
                    const result = await chrome.storage.local.get(['dropsInJug', 'lastResetDate', 'lastJugCount']);
                    const count = result.dropsInJug || 0;
                    const lastCount = result.lastJugCount || 0;
                    const today = new Date().toDateString();
                    const isNewDay = result.lastResetDate !== today;
                    
                    if (isNewDay) {
                        updateBrainJugCount(count, false, isNewDay); // New day - prioritize new day message over offline mode
                        if (count === 0) {
                            showStatus('🌅 New day! Start fresh!', 'info');
                        }
                    } else {
                        // Connection error - show offline mode
                        updateBrainJugCount(count, true, false);
                    }
                } catch (fallbackError) {
                    console.error('Error getting jug count from storage:', fallbackError);
                    updateBrainJugCount(0, true, false); // Offline mode
                }
            } else {
                // This is an unexpected error, log it
                console.error('Unexpected error triggering brain jug animation:', error);
                // Fallback: just get the count from storage
                try {
                    const result = await chrome.storage.local.get(['dropsInJug', 'lastResetDate', 'lastJugCount']);
                    const count = result.dropsInJug || 0;
                    const lastCount = result.lastJugCount || 0;
                    const today = new Date().toDateString();
                    const isNewDay = result.lastResetDate !== today;
                    
                    if (isNewDay) {
                        updateBrainJugCount(count, false, isNewDay); // New day - prioritize new day message over offline mode
                        if (count === 0) {
                            showStatus('🌅 New day! Start fresh!', 'info');
                        }
                    } else {
                        showIncrementThenTotal(count, lastCount); // Show increment if any
                    }
                } catch (fallbackError) {
                    console.error('Error getting jug count from storage:', fallbackError);
                    // Final fallback: show 0
                    updateBrainJugCount(0, true, false); // Offline mode
                }
            }
        }
    }

    // Load API key from storage
    async function loadApiKey() {
        try {
            const result = await chrome.storage.sync.get('apiKey');
            if (result.apiKey) {
                apiKeyInput.value = result.apiKey;
            }
        } catch (error) {
            showStatus('Error loading API key', 'error');
        }
    }

    // Save API key to storage
    async function saveApiKey() {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }
        try {
            await chrome.storage.sync.set({ apiKey });
            showStatus('API key saved successfully', 'success');
        } catch (error) {
            showStatus('Error saving API key', 'error');
        }
    }

    saveApiKeyBtn.addEventListener('click', saveApiKey);

    // Load auto-process setting from storage
    async function loadAutoProcessSetting() {
        try {
            const result = await chrome.storage.sync.get('autoProcess');
            const localResult = await chrome.storage.local.get('autoProcess');
            // Prefer sync storage, fallback to local
            autoProcessCheckbox.checked = result.autoProcess || localResult.autoProcess || false;
            // Ensure both storages are in sync
            if (result.autoProcess !== undefined) {
                await chrome.storage.local.set({ autoProcess: result.autoProcess });
            } else if (localResult.autoProcess !== undefined) {
                await chrome.storage.sync.set({ autoProcess: localResult.autoProcess });
            }
        } catch (error) {
            console.error('Error loading auto-process setting:', error);
        }
    }

    // Save auto-process setting to storage
    autoProcessCheckbox.addEventListener('change', async () => {
        try {
            await chrome.storage.sync.set({ autoProcess: autoProcessCheckbox.checked });
            // Also save to local for quick access
            await chrome.storage.local.set({ autoProcess: autoProcessCheckbox.checked });
            showStatus(
                autoProcessCheckbox.checked 
                    ? 'Auto-processing enabled' 
                    : 'Auto-processing disabled', 
                'success'
            );
            // Update button styling
            updateProcessButtonState();
        } catch (error) {
            showStatus('Error saving setting', 'error');
        }
    });

    // Load replacements from storage
    async function loadReplacements() {
        try {
            const result = await chrome.storage.sync.get('replacements');
            replacements = result.replacements || [];
        } catch (error) {
            showStatus('Error loading replacements', 'error');
        }
    }

    // Save replacements to storage
    async function saveReplacements() {
        try {
            await chrome.storage.sync.set({ replacements });
        } catch (error) {
            showStatus('Error saving replacements', 'error');
        }
    }

    // Add replacement
    addReplacementBtn.addEventListener('click', async () => {
        const replacement = replacementWordInput.value.trim();
        if (!replacement) {
            showStatus('Please enter a word/phrase to learn', 'error');
            return;
        }
        showStatus('Extracting concept with AI...', 'info');
        try {
            const result = await chrome.runtime.sendMessage({
                action: 'EXTRACT_ORIGINAL_CONCEPT',
                replacementWord: replacement
            });
            if (result.error) {
                showStatus('AI extraction failed', 'error');
                return;
            }
            // Handle both old format (single concept) and new format (array of concepts)
            const originalConcepts = result.originalConcepts || (result.originalConcept ? [result.originalConcept] : []);
            
            const newReplacement = {
                id: Date.now().toString(),
                original: originalConcepts, // Store as array
                replacement
            };
            replacements.push(newReplacement);
            await saveReplacements();
            renderReplacementsList();
            replacementWordInput.value = '';
            showStatus('Replacement added successfully', 'success');
        } catch (error) {
            showStatus('Error extracting concept', 'error');
        }
    });

    // Remove replacement
    function removeReplacement(id) {
        replacements = replacements.filter(r => r.id !== id);
        saveReplacements();
        renderReplacementsList();
        showStatus('Replacement removed', 'success');
    }

    // Render replacements list
    function renderReplacementsList() {
        replacementsList.innerHTML = '';
        replacements.forEach(replacement => {
            const item = document.createElement('div');
            item.className = 'replacement-item';
            const text = document.createElement('span');
            text.textContent = replacement.replacement;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.innerHTML = '<i class="fa fa-trash"></i>';
            removeBtn.onclick = () => removeReplacement(replacement.id);
            item.appendChild(text);
            item.appendChild(removeBtn);
            replacementsList.appendChild(item);
        });
    }

    // Update process button state
    async function updateProcessButtonState() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const result = await chrome.storage.local.get(['processedTabs', 'autoProcess']);
            const processedTabs = result.processedTabs || {};
            const isProcessed = processedTabs[tab.id] || false;
            const autoProcessEnabled = result.autoProcess || false;
            
            const processBtnText = processPageBtn.querySelector('.process-btn-text');
            
            if (isProcessed) {
                processPageBtn.classList.add('processed');
                processBtnText.textContent = 'Processed';
            } else {
                processPageBtn.classList.remove('processed');
                processBtnText.textContent = 'Process Page';
            }
            
            if (autoProcessEnabled) {
                processPageBtn.classList.add('auto-process-enabled');
            } else {
                processPageBtn.classList.remove('auto-process-enabled');
            }
        } catch (error) {
            console.error('Error updating process button state:', error);
        }
    }

    // Process current page
    processPageBtn.addEventListener('click', async () => {
        if (replacements.length === 0) {
            showStatus('No replacements defined', 'error');
            return;
        }
        const result = await chrome.storage.sync.get('apiKey');
        if (!result.apiKey) {
            showStatus('Please set your API key first', 'error');
            return;
        }
        
        // Check if we're on a valid page for content scripts
        const isValidPage = await isValidPageForContentScript();
        if (!isValidPage) {
            showStatus('Cannot process this page. Try a regular website.', 'error');
            return;
        }
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            showStatus('Processing page...', 'info');
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['src/content/content.js']
            });
            chrome.tabs.sendMessage(tab.id, { action: 'SHOW_MAIN_TEXT_POPUP' });
            chrome.tabs.sendMessage(tab.id, { action: 'PROCESS_PAGE_TEXT', replacements });
            
            // Mark tab as processed
            const storageResult = await chrome.storage.local.get('processedTabs');
            const processedTabs = storageResult.processedTabs || {};
            processedTabs[tab.id] = true;
            await chrome.storage.local.set({ processedTabs });
            
            // Update button state
            updateProcessButtonState();
        } catch (error) {
            console.error('Error in processPage button handler:', error);
            showStatus(`Error processing page: ${error.message}`, 'error');
        }
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'PROCESSING_COMPLETE') {
            showStatus(`Processed ${message.replacementsMade} replacements`, 'success');
            // Mark tab as processed
            if (sender.tab) {
                chrome.storage.local.get('processedTabs', (result) => {
                    const processedTabs = result.processedTabs || {};
                    processedTabs[sender.tab.id] = true;
                    chrome.storage.local.set({ processedTabs });
                    updateProcessButtonState();
                });
            }
            // Update brain jug count after processing
            setTimeout(() => {
                triggerBrainJugAnimation();
            }, 500);
        } else if (message.type === 'PROCESSING_ERROR') {
            console.error('Processing error from content script:', message.error);
            showStatus(`Error processing page: ${message.error || 'Unknown error'}`, 'error');
        } else if (message.type === 'BRAIN_JUG_UPDATE') {
            // Live update when popup is open and new words are viewed
            const currentCount = message.count;
            const lastCount = message.lastCount || 0;
            const increment = currentCount - lastCount;
            
            if (increment > 0) {
                showIncrementThenUpdate(lastCount, increment, currentCount);
                chrome.storage.local.set({ lastJugCount: currentCount });
                
                // Trigger drop animation for live update
                const dropsToAnimate = Math.min(50, increment);
                chrome.tabs.sendMessage(sender.tab.id, { 
                    command: 'animateDrops', 
                    count: dropsToAnimate 
                }).catch(() => {
                    // Ignore errors if content script is not available
                });
            }
        }
    });

    // Animate details expand/collapse with smooth transition
    function setupAccordion(detailsId, contentId, summarySelector) {
        const details = document.getElementById(detailsId);
        const content = document.getElementById(contentId);
        const summary = details.querySelector(summarySelector);

        if (!details || !content || !summary) return;

        summary.addEventListener('click', (e) => {
            e.preventDefault();
            
            if (details.hasAttribute('open')) {
                // Closing animation
                const startHeight = content.offsetHeight;
                content.style.maxHeight = `${startHeight}px`;
                
                requestAnimationFrame(() => {
                    content.style.maxHeight = '0px';
                    // Wait for transition to finish
                    content.addEventListener('transitionend', function onEnd() {
                        if (content.style.maxHeight === '0px') {
                            details.removeAttribute('open');
                            content.style.maxHeight = null;
                        }
                    }, { once: true });
                });
            } else {
                // Opening animation
                details.setAttribute('open', '');
                content.style.maxHeight = '0px';
                
                requestAnimationFrame(() => {
                    const endHeight = content.scrollHeight;
                    content.style.maxHeight = `${endHeight}px`;
                    
                    content.addEventListener('transitionend', function onEnd() {
                        if (content.style.maxHeight !== '0px') {
                            content.style.maxHeight = 'none';
                        }
                    }, { once: true });
                });
            }
        });
    }

    setupAccordion('wordListDetails', 'wordListContent', '.section-header');
    setupAccordion('settingsDetails', 'settingsContent', '.settings-summary');

    // Initial load
    await loadReplacements();
    await loadApiKey();
    await loadAutoProcessSetting();
    renderReplacementsList();
    await updateProcessButtonState();
    
    // Trigger brain jug animation on popup open
    setTimeout(() => {
        triggerBrainJugAnimation();
    }, 300);
    
    // Listen for tab updates to reset processed state when navigating
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            chrome.storage.local.get('processedTabs', (result) => {
                const processedTabs = result.processedTabs || {};
                delete processedTabs[tabId];
                chrome.storage.local.set({ processedTabs });
            });
        }
    });
    
    // Notify content script when popup closes
    window.addEventListener('beforeunload', async () => {
        try {
            const isValidPage = await isValidPageForContentScript();
            if (isValidPage) {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.sendMessage(tab.id, { command: 'popupClosed' }).catch(() => {
                    // Ignore errors if content script is not available
                });
            }
        } catch (error) {
            // Ignore errors when popup closes
        }
    });
}); 