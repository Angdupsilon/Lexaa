// Prevent multiple executions of this content script
(function() {
    if (window.lexaContentScriptLoaded) {
        // Script already loaded, exit early
        return;
    }
    
    // Exit early on restricted pages (chrome://, about:, etc.)
    const url = window.location.href;
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') || 
        url.startsWith('about:') || 
        url.startsWith('edge://') ||
        url.startsWith('moz-extension://') ||
        url.startsWith('safari-extension://')) {
        return;
    }
    
    window.lexaContentScriptLoaded = true;

// Add styles for highlighted text overlays and tooltips
    // Check if styles already exist to prevent duplicate injection
    if (!document.getElementById('lexa-styles')) {
        const style = document.createElement('style');
        style.id = 'lexa-styles';
        style.textContent = `
            .tooltip {
                visibility: hidden;
                opacity: 0;
                position: absolute;
                left: 50%;
                bottom: 125%;
                transform: translateX(-50%) scale(0.95);
                background: rgba(110, 72, 170, 0.92);
                color: #fff;
                padding: 8px 14px;
                border-radius: 6px;
                font-size: 15px;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 500px;
                z-index: 1000;
                box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                pointer-events: none;
                transition: opacity 0.2s ease, transform 0.2s ease;
                text-align: center;
                display: inline-block;
            }
            .tooltip.show, .ai-language-learner-replacement:hover .tooltip, .ai-language-learner-overlay-container:hover .tooltip {
                visibility: visible;
                opacity: 1;
                transform: translateX(-50%) scale(1);
                pointer-events: auto;
            }
            .ai-language-learner-overlay-container {
                display: inline;
                position: relative;
            }
            .ai-language-learner-overlay-original {
                display: inline;
                visibility: hidden;
                font-family: inherit !important;
                font-size: inherit !important;
                font-weight: inherit !important;
                color: inherit !important;
                line-height: inherit !important;
                letter-spacing: inherit !important;
                text-transform: inherit !important;
                font-style: inherit !important;
                padding: 0 2px;
                margin: 0;
                border-radius: 4px;
                vertical-align: baseline;
                position: relative;
                z-index: 3;
            }
            .ai-language-learner-overlay-box {
                display: inline;
                background: #fff9c4 !important; /* Light yellow highlight */
                color: #333 !important;
                font-weight: bold !important;
                border-radius: 4px;
                padding: 0 2px;
                margin: 0;
                z-index: 2;
                cursor: pointer;
                transition: opacity 0.2s;
                box-shadow: 0 1px 4px rgba(0,0,0,0.08);
                border: 1.5px solid #ffe082 !important; /* Subtle border for highlight */
                font-family: inherit !important;
                font-size: inherit !important;
                font-weight: inherit !important;
                color: inherit !important;
                line-height: inherit !important;
                letter-spacing: inherit !important;
                text-transform: inherit !important;
                font-style: inherit !important;
                vertical-align: baseline;
                position: relative;
            }
            .ai-language-learner-overlay-container:hover .ai-language-learner-overlay-box {
                opacity: 0;
            }
            .ai-language-learner-overlay-container:hover .ai-language-learner-overlay-original {
                visibility: visible;
                color: #d32f2f;
                background: #fff;
                z-index: 3;
                position: relative;
            }
            .ai-language-learner-replacement {
                background: #fff9b1 !important;
                border: none;
                border-radius: 2px;
                padding: 0 4px;
                display: inline;
                cursor: pointer;
                font-weight: bold;
                position: relative;
                transition: none;
                box-shadow: none;
                color: #222;
            }
            .ai-language-learner-replacement:hover {
                /* No extra shadow on hover for Word-like effect */
            }
        `;
        document.head.appendChild(style);
    }

    // Clean up any existing debug outlines
    document.querySelectorAll('.ai-language-learner-replacement').forEach(el => {
        if (el.style.outline) {
            el.style.outline = '';
        }
    });

    // Variables for brain jug tracking
    let dropsInJug = 0;
    let hasReachedMax = false;
    let jugObserver = null;
    const observedElements = new Set();
    const processedElements = new Set();
    let popupIsOpen = false; // Track if popup is open for live updates
    let brainJugInitialized = false; // Track if brain jug tracking has been initialized
    
    // Batch size for processing paragraphs (optimization: reduces API calls)
    const BATCH_SIZE = 5; // Process 5 paragraphs at a time

    // Helper function to check if extension context is still valid
    function isExtensionContextValid() {
        try {
            // Accessing chrome.runtime.id will throw if context is invalidated
            return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id !== undefined;
        } catch (e) {
            return false;
        }
    }

    // Helper function to safely use Chrome storage APIs
    async function safeChromeStorageSet(data) {
        if (!isExtensionContextValid()) {
            console.warn('Extension context invalidated, cannot save to storage');
            return Promise.reject(new Error('Extension context invalidated'));
        }
        try {
            return await chrome.storage.local.set(data);
        } catch (err) {
            // Check if it's a context invalidated error
            if (err.message && err.message.includes('Extension context invalidated')) {
                console.warn('Extension context invalidated during storage operation');
                return Promise.reject(err);
            }
            throw err;
        }
    }

    // Helper function to safely send runtime messages
    async function safeChromeRuntimeSendMessage(message) {
        if (!isExtensionContextValid()) {
            console.warn('Extension context invalidated, cannot send message');
            return Promise.reject(new Error('Extension context invalidated'));
        }
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (err) {
            // Check if it's a context invalidated error or connection error
            if (err.message && (err.message.includes('Extension context invalidated') || 
                                err.message.includes('Could not establish connection'))) {
                console.warn('Extension context invalidated during message send');
                return Promise.reject(err);
            }
            throw err;
        }
    }

    function initializeBrainJugTracking() {
        try {
            // Create IntersectionObserver to watch replaced elements
            jugObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    // Only count if element is significantly visible and hasn't been counted before
                    if (entry.isIntersecting && 
                        entry.intersectionRatio >= 0.5 && // At least 50% visible
                        !observedElements.has(entry.target) &&
                        dropsInJug < 200) {
                        
                        // Check if element is actually visible to user (not hidden by CSS)
                        const rect = entry.target.getBoundingClientRect();
                        const isVisible = rect.width > 0 && rect.height > 0 && 
                                        window.getComputedStyle(entry.target).visibility !== 'hidden' &&
                                        window.getComputedStyle(entry.target).display !== 'none';
                        
                        if (isVisible) {
                            const previousCount = dropsInJug;
                            dropsInJug++;
                            observedElements.add(entry.target);
                            
                            // Check if we just reached 200 for the first time
                            if (dropsInJug === 200 && !hasReachedMax) {
                                hasReachedMax = true;
                                safeChromeStorageSet({ hasReachedMax: true }).catch(err => {
                                    if (!err.message.includes('Extension context invalidated')) {
                                        console.error('Error saving max reached state:', err);
                                    }
                                });
                            }
                            
                            jugObserver.unobserve(entry.target);
                            // Save to storage
                            safeChromeStorageSet({ dropsInJug }).catch(err => {
                                if (!err.message.includes('Extension context invalidated')) {
                                    console.error('Error saving drops count:', err);
                                }
                            });
                            
                            // Send live update if popup is open
                            if (popupIsOpen) {
                                safeChromeRuntimeSendMessage({
                                    type: 'BRAIN_JUG_UPDATE',
                                    count: dropsInJug,
                                    lastCount: previousCount
                                }).catch(err => {
                                    // Ignore errors if popup is closed or context invalidated
                                    if (err.message.includes('Extension context invalidated')) {
                                        popupIsOpen = false;
                                    } else {
                                        console.log('Popup closed, stopping live updates');
                                        popupIsOpen = false;
                                    }
                                });
                            }
                        }
                    }
                });
            }, { 
                threshold: 0.5, // Increased threshold to 50%
                rootMargin: '0px 0px -10% 0px' // Don't count elements at very bottom of viewport
            });

            // Observe all existing replaced elements
            observeReplacedElements();
        } catch (error) {
            console.error('Error initializing brain jug tracking:', error);
        }
    }

    // Observe replaced elements for brain jug tracking
    function observeReplacedElements() {
        try {
            const replacedElements = document.querySelectorAll('.ai-language-learner-replacement');
            replacedElements.forEach(el => {
                if (!jugObserver) return;
                
                // Only observe elements that haven't been counted yet
                if (!observedElements.has(el)) {
                    jugObserver.observe(el);
                }
            });
        } catch (error) {
            console.error('Error observing replaced elements:', error);
        }
    }

    // Animate drops falling into the jug
    function animateJugDrops(count) {
        const dropCount = Math.min(count, 50); // Limit to 50 drops for performance
        
        for (let i = 0; i < dropCount; i++) {
            setTimeout(() => {
                const drop = document.createElement('div');
                drop.className = 'brain-drop';
                drop.style.left = (Math.random() * window.innerWidth) + 'px';
                drop.style.animationDelay = (Math.random() * 0.5) + 's';
                document.body.appendChild(drop);
                
                // Remove drop after animation
                setTimeout(() => {
                    if (drop.parentNode) {
                        drop.parentNode.removeChild(drop);
                    }
                }, 3000);
            }, i * 20); // Stagger drops
        }
    }

    // Add CSS for brain drops
    // Check if brain drop styles already exist to prevent duplicate injection
    if (!document.getElementById('lexa-brain-drops')) {
        const brainDropStyles = document.createElement('style');
        brainDropStyles.id = 'lexa-brain-drops'; // Add ID to prevent duplicates
        brainDropStyles.textContent = `
            .brain-drop {
                position: fixed;
                top: -20px;
                width: 8px;
                height: 8px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 50%;
                animation: brainDropFall 3s linear forwards;
                pointer-events: none;
                z-index: 9999;
                box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
            }
            
            @keyframes brainDropFall {
                0% { 
                    transform: translateY(0) scale(1); 
                    opacity: 1; 
                }
                80% { 
                    transform: translateY(90vh) scale(1); 
                    opacity: 1; 
                }
                100% { 
                    transform: translateY(95vh) scale(0.5); 
                    opacity: 0; 
                }
            }
        `;
        document.head.appendChild(brainDropStyles);
    }

// Revert page to original state
function revertPage() {
    let revertCount = 0;
    
    // Function to merge adjacent text nodes
    function mergeTextNodes(element) {
        if (!element) return;
        let node = element.firstChild;
        while (node) {
            const next = node.nextSibling;
            if (node.nodeType === Node.TEXT_NODE && next && next.nodeType === Node.TEXT_NODE) {
                node.textContent += next.textContent;
                element.removeChild(next);
            } else {
                node = next;
            }
        }
    }
    
    // Handle replacement spans
    const replacementSpans = document.querySelectorAll('.ai-language-learner-replacement');
    replacementSpans.forEach(span => {
        // Get original text from data attribute or tooltip
        const originalText = span.getAttribute('data-original') || 
                           (span.querySelector('.tooltip')?.textContent || '');
        
        if (originalText && span.parentNode) {
            // Create a text node with the original text
            const textNode = document.createTextNode(originalText);
            // Replace the span with the original text
            span.parentNode.replaceChild(textNode, span);
            revertCount++;
            
            // Merge adjacent text nodes in the parent
            mergeTextNodes(span.parentNode);
        }
    });
    
    // Also handle overlay containers if they exist
    const overlayContainers = document.querySelectorAll('.ai-language-learner-overlay-container');
    overlayContainers.forEach(container => {
        const originalSpan = container.querySelector('.ai-language-learner-overlay-original');
        
        if (originalSpan && container.parentNode) {
            const originalText = originalSpan.textContent || originalSpan.getAttribute('data-original') || '';
            if (originalText) {
                const textNode = document.createTextNode(originalText);
                container.parentNode.replaceChild(textNode, container);
                revertCount++;
                
                // Merge adjacent text nodes in the parent
                mergeTextNodes(container.parentNode);
            }
        }
    });
    
    // Clear processed elements set so page can be processed again
    processedElements.clear();
    
    return { revertedCount: revertCount };
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PROCESS_PAGE_TEXT') {
        processPage(message.replacements)
            .then(result => {
                // Only mark as processed if not already processed
                if (!result.alreadyProcessed) {
                    // Mark tab as processed
                    if (isExtensionContextValid()) {
                        chrome.storage.local.get('processedTabs', (storageResult) => {
                            if (!isExtensionContextValid()) return;
                            const processedTabs = storageResult.processedTabs || {};
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                if (tabs[0] && isExtensionContextValid()) {
                                    processedTabs[tabs[0].id] = true;
                                    safeChromeStorageSet({ processedTabs }).catch(err => {
                                        if (!err.message.includes('Extension context invalidated')) {
                                            console.error('Error saving processed tabs:', err);
                                        }
                                    });
                                }
                            });
                        });
                        
                        safeChromeRuntimeSendMessage({
                            type: 'PROCESSING_COMPLETE',
                            replacementsMade: result.replacementsMade
                        }).catch(err => {
                            if (!err.message.includes('Extension context invalidated')) {
                                console.error('Error sending processing complete message:', err);
                            }
                        });
                    }
                } else {
                    // Send response indicating already processed
                    if (isExtensionContextValid()) {
                        safeChromeRuntimeSendMessage({
                            type: 'PROCESSING_COMPLETE',
                            replacementsMade: 0,
                            alreadyProcessed: true
                        }).catch(err => {
                            if (!err.message.includes('Extension context invalidated')) {
                                console.error('Error sending processing complete message:', err);
                            }
                        });
                    }
                }
            })
            .catch(error => {
                console.error('Error processing page:', error);
                if (isExtensionContextValid()) {
                    safeChromeRuntimeSendMessage({
                        type: 'PROCESSING_ERROR',
                        error: error.message
                    }).catch(err => {
                        if (!err.message.includes('Extension context invalidated')) {
                            console.error('Error sending processing error message:', err);
                        }
                    });
                }
            });
        return true; // Keep message channel open for async response
    } else if (message.action === 'REVERT_PAGE') {
        const result = revertPage();
        // Clear processed state for this tab
        if (isExtensionContextValid()) {
            chrome.storage.local.get('processedTabs', (storageResult) => {
                if (!isExtensionContextValid()) return;
                const processedTabs = storageResult.processedTabs || {};
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0] && isExtensionContextValid()) {
                        delete processedTabs[tabs[0].id];
                        safeChromeStorageSet({ processedTabs }).catch(err => {
                            if (!err.message.includes('Extension context invalidated')) {
                                console.error('Error clearing processed tabs:', err);
                            }
                        });
                    }
                });
            });
            
            safeChromeRuntimeSendMessage({
                type: 'REVERT_COMPLETE',
                revertedCount: result.revertedCount
            }).catch(err => {
                if (!err.message.includes('Extension context invalidated')) {
                    console.error('Error sending revert complete message:', err);
                }
            });
        }
    } else if (message.command === 'showJugAnimation') {
            // Calculate incremental drops since last popup open
            if (!isExtensionContextValid()) {
                sendResponse({ count: dropsInJug });
                return true;
            }
            chrome.storage.local.get(['lastJugCount'], (result) => {
                if (!isExtensionContextValid()) {
                    sendResponse({ count: dropsInJug });
                    return;
                }
                let lastCount = result.lastJugCount || 0;
                let increment = dropsInJug - lastCount;
                increment = Math.max(0, increment); // protect against negative
                let dropsToAnimate = Math.min(50, increment); // still performance capped
                
                animateJugDrops(dropsToAnimate);
                safeChromeStorageSet({ lastJugCount: dropsInJug }).catch(err => {
                    if (!err.message.includes('Extension context invalidated')) {
                        console.error('Error saving lastJugCount:', err);
                    }
                });
                sendResponse({ count: dropsInJug });
            });
            return true; // for async
        } else if (message.command === 'getJugCount') {
            // Return current count without animation
            popupIsOpen = true; // Mark popup as open for live updates
            sendResponse({ count: dropsInJug });
            return true; // Keep message channel open for response
        } else if (message.command === 'animateDrops') {
            // Animate drops without updating lastJugCount
            const dropsToAnimate = message.count || 0;
            animateJugDrops(dropsToAnimate);
            sendResponse({ success: true });
            return true; // Keep message channel open for response
        } else if (message.command === 'popupClosed') {
            // Popup closed, stop live updates
            popupIsOpen = false;
        }
    });

    // Don't initialize brain jug tracking on load - wait for replacements to be made

    // Load saved drops count from storage
    if (isExtensionContextValid()) {
        chrome.storage.local.get(['dropsInJug', 'hasReachedMax', 'lastResetDate'], (result) => {
            if (!isExtensionContextValid()) return; // Check again in callback
            
            if (result.dropsInJug !== undefined) {
                dropsInJug = result.dropsInJug;
            }
            if (result.hasReachedMax !== undefined) {
                hasReachedMax = result.hasReachedMax;
            }
            
            // Check for daily reset
            const today = new Date().toDateString();
            const lastResetDate = result.lastResetDate;
            
            if (lastResetDate !== today) {
                // It's a new day, reset the counter
                dropsInJug = 0;
                hasReachedMax = false;
                observedElements.clear(); // Reset observed elements for new day
                safeChromeStorageSet({ 
                    dropsInJug: 0, 
                    hasReachedMax: false, 
                    lastResetDate: today,
                    lastJugCount: 0 
                }).catch(err => {
                    if (!err.message.includes('Extension context invalidated')) {
                        console.error('Error resetting drops count:', err);
                    }
                });
            }
            
            // Initialize lastJugCount if it doesn't exist
            if (isExtensionContextValid()) {
                chrome.storage.local.get(['lastJugCount'], (lastResult) => {
                    if (!isExtensionContextValid()) return; // Check again in callback
                    if (lastResult.lastJugCount === undefined) {
                        safeChromeStorageSet({ lastJugCount: dropsInJug }).catch(err => {
                            if (!err.message.includes('Extension context invalidated')) {
                                console.error('Error initializing lastJugCount:', err);
                            }
                        });
                    }
                });
            }
        });
    }

// Pre-filter: Quick check if text might contain any of the concepts
function mightContainConcept(text, replacements) {
    const lowerText = text.toLowerCase();
    for (const rule of replacements) {
        // Handle both old format (string) and new format (array)
        const concepts = Array.isArray(rule.original) ? rule.original : [rule.original];
        
        // Check each concept in the array
        for (const concept of concepts) {
            // Check if text contains any significant word from the original concept
            const conceptWords = concept.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            if (conceptWords.length === 0) {
                // If concept is too short, check the whole thing
                if (lowerText.includes(concept.toLowerCase().substring(0, 4))) {
                    return true;
                }
            } else {
                // Check if at least one significant word from concept appears
                for (const word of conceptWords) {
                    if (lowerText.includes(word)) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// Process the entire page with optimized batching
async function processPage(replacements) {
    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
        console.warn('Extension context invalidated, cannot process page');
        return { replacementsMade: 0, alreadyProcessed: false };
    }

    // Check if page is already processed
    let tabResult;
    try {
        tabResult = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
        if (err.message && err.message.includes('Extension context invalidated')) {
            console.warn('Extension context invalidated during tab query');
            return { replacementsMade: 0, alreadyProcessed: false };
        }
        throw err;
    }
    
    if (tabResult[0]) {
        try {
            const storageResult = await chrome.storage.local.get('processedTabs');
            const processedTabs = storageResult.processedTabs || {};
            if (processedTabs[tabResult[0].id]) {
                // Page is already processed, don't reprocess
                return { replacementsMade: 0, alreadyProcessed: true };
            }
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                console.warn('Extension context invalidated during storage get');
                return { replacementsMade: 0, alreadyProcessed: false };
            }
            throw err;
        }
    }
    
    // Initialize brain jug tracking when replacements are about to be made
    if (!brainJugInitialized) {
        initializeBrainJugTracking();
        brainJugInitialized = true;
    }
    
    let replacementsMade = 0;
    const textBlocks = findTextBlocks();
    
    // Filter out already processed blocks and blocks that likely don't contain concepts
    const blocksToProcess = textBlocks.filter(block => {
        if (processedElements.has(block)) return false;
        const text = block.textContent;
        if (!text.trim()) return false;
        // Pre-filter: skip blocks that clearly don't contain any concepts
        return mightContainConcept(text, replacements);
    });

    if (blocksToProcess.length === 0) {
        return { replacementsMade: 0 };
    }

    // Process in batches
    for (let i = 0; i < blocksToProcess.length; i += BATCH_SIZE) {
        const batch = blocksToProcess.slice(i, i + BATCH_SIZE);
        const batchTexts = batch.map(block => block.textContent);
        
        try {
            // Check if extension context is still valid before API call
            if (!isExtensionContextValid()) {
                console.warn('Extension context invalidated during batch processing');
                // Mark all blocks in batch as processed to avoid infinite loops
                for (let j = 0; j < batch.length; j++) {
                    processedElements.add(batch[j]);
                }
                continue;
            }

            // Single API call for entire batch with all rules
            const result = await safeChromeRuntimeSendMessage({
                action: 'ANALYZE_BATCH_WITH_AI',
                textBlocks: batchTexts,
                replacements: replacements
            });

            if (result.error) {
                console.error('AI Batch Analysis Error:', result.error);
                // Fallback to individual processing for this batch
                for (let j = 0; j < batch.length; j++) {
                    processedElements.add(batch[j]);
                }
                continue;
            }

            // Group results by paragraph index
            const resultsByParagraph = {};
            if (result.results && Array.isArray(result.results)) {
                for (const item of result.results) {
                    // Validate item has required fields and paragraph_index is within batch range
                    if (item && 
                        typeof item.paragraph_index === 'number' && 
                        item.paragraph_index >= 0 && 
                        item.paragraph_index < batch.length &&
                        item.rule_id &&
                        item.original_phrase &&
                        item.replacement_form) {
                        const paraIndex = item.paragraph_index;
                        if (!resultsByParagraph[paraIndex]) {
                            resultsByParagraph[paraIndex] = [];
                        }
                        resultsByParagraph[paraIndex].push(item);
                    }
                }
            }

            // Apply replacements to each paragraph in the batch
            for (let j = 0; j < batch.length; j++) {
                const block = batch[j];
                const paraResults = resultsByParagraph[j] || [];
                
                // Group replacements by rule_id for efficient processing
                const replacementsByRule = {};
                for (const item of paraResults) {
                    if (!replacementsByRule[item.rule_id]) {
                        replacementsByRule[item.rule_id] = [];
                    }
                    replacementsByRule[item.rule_id].push({
                        original_phrase: item.original_phrase,
                        replacement_form: item.replacement_form
                    });
                }

                // Apply all replacements for this block
                for (const ruleId in replacementsByRule) {
                    const ruleReplacements = replacementsByRule[ruleId];
                    if (ruleReplacements.length > 0) {
                        replacementsMade += await replacePhrasesInElement(
                            block,
                            ruleReplacements
                        );
                    }
                }
                
                processedElements.add(block);
            }
        } catch (error) {
            console.error('Error processing batch:', error);
            // Mark all blocks in batch as processed to avoid infinite loops
            for (const block of batch) {
                processedElements.add(block);
            }
        }
    }

    return { replacementsMade };
}

// Find relevant text blocks on the page
function findTextBlocks() {
    // Only add all <p> elements that are visible and have text
    return Array.from(document.querySelectorAll('p')).filter(p => {
        return p.offsetParent !== null && p.textContent.trim();
    });
}

// Replace phrases in an element
async function replacePhrasesInElement(element, replacements) {
    let replacementsMade = 0;
    // Sort by length of original_phrase (descending) to handle overlapping matches
    replacements.sort((a, b) => b.original_phrase.length - a.original_phrase.length);
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
    );
    const nodesToProcess = [];
    let node;
    while (node = walker.nextNode()) {
        nodesToProcess.push(node);
    }
    for (const node of nodesToProcess) {
        let text = node.textContent;
        let hasReplacement = false;
        for (const { original_phrase, replacement_form } of replacements) {
            if (text.includes(original_phrase)) {
                const parts = text.split(original_phrase);
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) {
                        const replacementSpan = document.createElement('span');
                        replacementSpan.textContent = replacement_form;
                        replacementSpan.className = 'ai-language-learner-replacement';
                        // Store original text in data attribute for easy reversion
                        replacementSpan.setAttribute('data-original', original_phrase);
                        // Custom tooltip for original text
                        const tooltip = document.createElement('span');
                        tooltip.className = 'tooltip';
                        tooltip.textContent = original_phrase;
                        replacementSpan.appendChild(tooltip);
                        // Copy computed styles for seamless integration
                        copyTextStyles(node, replacementSpan);
                        fragment.appendChild(replacementSpan);
                        replacementsMade++;
                    }
                    if (parts[i]) {
                        fragment.appendChild(document.createTextNode(parts[i]));
                    }
                }
                node.parentNode.replaceChild(fragment, node);
                hasReplacement = true;
                break;
            }
        }
        if (hasReplacement) {
            break;
        }
    }
        
        // After replacements are made, observe the new elements for brain jug tracking
        if (replacementsMade > 0) {
            setTimeout(() => {
                observeReplacedElements();
            }, 100);
        }
        
    return replacementsMade;
}

// Add helper function to copy computed styles
function copyTextStyles(fromNode, toNode) {
    const computed = window.getComputedStyle(fromNode.parentElement);
    toNode.style.fontFamily = computed.fontFamily;
    toNode.style.fontSize = computed.fontSize;
    toNode.style.fontWeight = computed.fontWeight;
    toNode.style.color = computed.color;
//    toNode.style.background = computed.background;
    toNode.style.lineHeight = computed.lineHeight;
    toNode.style.letterSpacing = computed.letterSpacing;
    toNode.style.textTransform = computed.textTransform;
    toNode.style.fontStyle = computed.fontStyle;
}

// Auto-process pages if enabled
let autoProcessObserver = null;
let autoProcessTimeout = null;

async function checkAndAutoProcess() {
    try {
        // Check if extension context is still valid
        if (!isExtensionContextValid()) {
            console.warn('Extension context invalidated, skipping auto-process');
            return;
        }

        // Check if auto-processing is enabled
        let result;
        try {
            result = await chrome.storage.sync.get(['autoProcess', 'replacements', 'apiKey']);
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                console.warn('Extension context invalidated during storage get');
                return;
            }
            throw err;
        }
        
        if (!result.autoProcess || !result.replacements || result.replacements.length === 0 || !result.apiKey) {
            return; // Auto-processing disabled, no replacements, or no API key
        }
        
        // Check if page is already processed before processing
        let tabResult;
        try {
            tabResult = await chrome.tabs.query({ active: true, currentWindow: true });
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                console.warn('Extension context invalidated during tab query');
                return;
            }
            throw err;
        }
        
        if (tabResult[0]) {
            try {
                const storageResult = await chrome.storage.local.get('processedTabs');
                const processedTabs = storageResult.processedTabs || {};
                if (processedTabs[tabResult[0].id]) {
                    // Page is already processed, don't reprocess
                    return;
                }
            } catch (err) {
                if (err.message && err.message.includes('Extension context invalidated')) {
                    console.warn('Extension context invalidated during storage get');
                    return;
                }
                throw err;
            }
        }
        
        // Function to process and mark as processed
        const processAndMark = async () => {
            if (!isExtensionContextValid()) {
                console.warn('Extension context invalidated, cannot process page');
                return { replacementsMade: 0, alreadyProcessed: false };
            }

            const processResult = await processPage(result.replacements);
            // Only mark as processed if not already processed
            if (!processResult.alreadyProcessed && isExtensionContextValid()) {
                // Mark tab as processed
                chrome.storage.local.get('processedTabs', (storageResult) => {
                    if (!isExtensionContextValid()) return;
                    const processedTabs = storageResult.processedTabs || {};
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0] && isExtensionContextValid()) {
                            processedTabs[tabs[0].id] = true;
                            safeChromeStorageSet({ processedTabs }).catch(err => {
                                if (!err.message.includes('Extension context invalidated')) {
                                    console.error('Error saving processed tabs:', err);
                                }
                            });
                        }
                    });
                });
            }
            return processResult;
        };
        
        // Wait for page to be fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => processAndMark(), 1000);
            });
        } else {
            // Page already loaded, wait a bit for dynamic content
            setTimeout(() => processAndMark(), 1000);
        }
        
        // Setup observer for dynamic content if not already set up
        setupAutoProcessObserver();
    } catch (error) {
        console.error('Error in auto-process check:', error);
    }
}

// Setup MutationObserver for dynamic content (SPAs, infinite scroll, etc.)
function setupAutoProcessObserver() {
    if (autoProcessObserver || !document.body) return;
    
    autoProcessObserver = new MutationObserver(async (mutations) => {
        // Check if extension context is still valid
        if (!isExtensionContextValid()) {
            return;
        }

        // Check if significant content was added
        const hasSignificantChanges = mutations.some(mutation => {
            return Array.from(mutation.addedNodes).some(node => 
                node.nodeType === 1 && // Element node
                (node.tagName === 'P' || (node.querySelector && node.querySelector('p')))
            );
        });
        
        if (hasSignificantChanges) {
            let result;
            try {
                result = await chrome.storage.sync.get(['autoProcess', 'replacements', 'apiKey']);
            } catch (err) {
                if (err.message && err.message.includes('Extension context invalidated')) {
                    console.warn('Extension context invalidated during storage get in observer');
                    return;
                }
                throw err;
            }
            
            if (result.autoProcess && result.replacements && result.replacements.length > 0 && result.apiKey) {
                // Check if page is already processed
                let tabResult;
                try {
                    tabResult = await chrome.tabs.query({ active: true, currentWindow: true });
                } catch (err) {
                    if (err.message && err.message.includes('Extension context invalidated')) {
                        console.warn('Extension context invalidated during tab query in observer');
                        return;
                    }
                    throw err;
                }
                
                if (tabResult[0]) {
                    try {
                        const storageResult = await chrome.storage.local.get('processedTabs');
                        const processedTabs = storageResult.processedTabs || {};
                        if (processedTabs[tabResult[0].id]) {
                            // Page is already processed, don't reprocess
                            return;
                        }
                    } catch (err) {
                        if (err.message && err.message.includes('Extension context invalidated')) {
                            console.warn('Extension context invalidated during storage get in observer');
                            return;
                        }
                        throw err;
                    }
                }
                
                // Debounce: wait 2 seconds after last change
                clearTimeout(autoProcessTimeout);
                autoProcessTimeout = setTimeout(async () => {
                    if (!isExtensionContextValid()) {
                        return;
                    }
                    const processResult = await processPage(result.replacements);
                    // Only mark as processed if not already processed
                    if (!processResult.alreadyProcessed && isExtensionContextValid()) {
                        // Mark tab as processed
                        chrome.storage.local.get('processedTabs', (storageResult) => {
                            if (!isExtensionContextValid()) return;
                            const processedTabs = storageResult.processedTabs || {};
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                if (tabs[0] && isExtensionContextValid()) {
                                    processedTabs[tabs[0].id] = true;
                                    safeChromeStorageSet({ processedTabs }).catch(err => {
                                        if (!err.message.includes('Extension context invalidated')) {
                                            console.error('Error saving processed tabs:', err);
                                        }
                                    });
                                }
                            });
                        });
                    }
                }, 2000);
            }
        }
    });
    
    autoProcessObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Run auto-process check
checkAndAutoProcess();

// Also listen for storage changes to re-process if setting changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
        return;
    }

    if (areaName === 'sync') {
        if (changes.autoProcess && changes.autoProcess.newValue) {
            // Auto-process was enabled, check and process
            chrome.storage.sync.get(['replacements', 'apiKey'], async (result) => {
                if (!isExtensionContextValid()) return;
                if (result.replacements && result.replacements.length > 0 && result.apiKey) {
                    // Check if page is already processed
                    let tabResult;
                    try {
                        tabResult = await chrome.tabs.query({ active: true, currentWindow: true });
                    } catch (err) {
                        if (err.message && err.message.includes('Extension context invalidated')) {
                            console.warn('Extension context invalidated during tab query in storage listener');
                            return;
                        }
                        throw err;
                    }
                    if (tabResult[0]) {
                        try {
                            const storageResult = await chrome.storage.local.get('processedTabs');
                            const processedTabs = storageResult.processedTabs || {};
                            if (!processedTabs[tabResult[0].id]) {
                                // Only process if not already processed
                                await processPage(result.replacements);
                            }
                        } catch (err) {
                            if (err.message && err.message.includes('Extension context invalidated')) {
                                console.warn('Extension context invalidated during storage get in storage listener');
                                return;
                            }
                            throw err;
                        }
                    }
                    setupAutoProcessObserver();
                }
            });
        } else if (changes.autoProcess && !changes.autoProcess.newValue) {
            // Auto-process was disabled, stop observing
            if (autoProcessObserver) {
                autoProcessObserver.disconnect();
                autoProcessObserver = null;
            }
            clearTimeout(autoProcessTimeout);
        } else if (changes.replacements && changes.replacements.newValue) {
            // Replacements changed, re-process if auto-process is enabled
            chrome.storage.sync.get(['autoProcess', 'apiKey'], async (result) => {
                if (!isExtensionContextValid()) return;
                if (result.autoProcess && changes.replacements.newValue.length > 0 && result.apiKey) {
                    // Check if page is already processed
                    let tabResult;
                    try {
                        tabResult = await chrome.tabs.query({ active: true, currentWindow: true });
                    } catch (err) {
                        if (err.message && err.message.includes('Extension context invalidated')) {
                            console.warn('Extension context invalidated during tab query in storage listener');
                            return;
                        }
                        throw err;
                    }
                    if (tabResult[0]) {
                        try {
                            const storageResult = await chrome.storage.local.get('processedTabs');
                            const processedTabs = storageResult.processedTabs || {};
                            if (!processedTabs[tabResult[0].id]) {
                                // Only process if not already processed
                                await processPage(changes.replacements.newValue);
                            }
                        } catch (err) {
                            if (err.message && err.message.includes('Extension context invalidated')) {
                                console.warn('Extension context invalidated during storage get in storage listener');
                                return;
                            }
                            throw err;
                        }
                    }
                }
            });
        }
    }
});
})(); 