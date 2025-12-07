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
    
    // Batch size for processing paragraphs (optimization: reduces API calls)
    const BATCH_SIZE = 5; // Process 5 paragraphs at a time

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
                                chrome.storage.local.set({ hasReachedMax: true }).catch(err => {
                                    console.error('Error saving max reached state:', err);
                                });
                            }
                            
                            jugObserver.unobserve(entry.target);
                            // Save to storage
                            chrome.storage.local.set({ dropsInJug }).catch(err => {
                                console.error('Error saving drops count:', err);
                            });
                            
                            // Send live update if popup is open
                            if (popupIsOpen) {
                                chrome.runtime.sendMessage({
                                    type: 'BRAIN_JUG_UPDATE',
                                    count: dropsInJug,
                                    lastCount: previousCount
                                }).catch(err => {
                                    // Ignore errors if popup is closed
                                    console.log('Popup closed, stopping live updates');
                                    popupIsOpen = false;
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PROCESS_PAGE_TEXT') {
        processPage(message.replacements)
            .then(result => {
                chrome.runtime.sendMessage({
                    type: 'PROCESSING_COMPLETE',
                    replacementsMade: result.replacementsMade
                });
            })
            .catch(error => {
                console.error('Error processing page:', error);
                chrome.runtime.sendMessage({
                    type: 'PROCESSING_ERROR',
                    error: error.message
                });
            });
        // No return true needed - we're not sending a response via sendResponse
    } else if (message.command === 'showJugAnimation') {
            // Calculate incremental drops since last popup open
            chrome.storage.local.get(['lastJugCount'], (result) => {
                let lastCount = result.lastJugCount || 0;
                let increment = dropsInJug - lastCount;
                increment = Math.max(0, increment); // protect against negative
                let dropsToAnimate = Math.min(50, increment); // still performance capped
                
                animateJugDrops(dropsToAnimate);
                chrome.storage.local.set({ lastJugCount: dropsInJug });
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

    // Initialize brain jug tracking when content script loads
    initializeBrainJugTracking();

    // Load saved drops count from storage
    chrome.storage.local.get(['dropsInJug', 'hasReachedMax', 'lastResetDate'], (result) => {
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
            chrome.storage.local.set({ 
                dropsInJug: 0, 
                hasReachedMax: false, 
                lastResetDate: today,
                lastJugCount: 0 
            });
        }
        
        // Initialize lastJugCount if it doesn't exist
        chrome.storage.local.get(['lastJugCount'], (lastResult) => {
            if (lastResult.lastJugCount === undefined) {
                chrome.storage.local.set({ lastJugCount: dropsInJug });
            }
        });
    });

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
            // Single API call for entire batch with all rules
            const result = await chrome.runtime.sendMessage({
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
        // Check if auto-processing is enabled
        const result = await chrome.storage.sync.get(['autoProcess', 'replacements', 'apiKey']);
        
        if (!result.autoProcess || !result.replacements || result.replacements.length === 0 || !result.apiKey) {
            return; // Auto-processing disabled, no replacements, or no API key
        }
        
        // Wait for page to be fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => processPage(result.replacements), 1000);
            });
        } else {
            // Page already loaded, wait a bit for dynamic content
            setTimeout(() => processPage(result.replacements), 1000);
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
        // Check if significant content was added
        const hasSignificantChanges = mutations.some(mutation => {
            return Array.from(mutation.addedNodes).some(node => 
                node.nodeType === 1 && // Element node
                (node.tagName === 'P' || (node.querySelector && node.querySelector('p')))
            );
        });
        
        if (hasSignificantChanges) {
            const result = await chrome.storage.sync.get(['autoProcess', 'replacements', 'apiKey']);
            if (result.autoProcess && result.replacements && result.replacements.length > 0 && result.apiKey) {
                // Debounce: wait 2 seconds after last change
                clearTimeout(autoProcessTimeout);
                autoProcessTimeout = setTimeout(() => {
                    processPage(result.replacements);
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
    if (areaName === 'sync') {
        if (changes.autoProcess && changes.autoProcess.newValue) {
            // Auto-process was enabled, check and process
            chrome.storage.sync.get(['replacements', 'apiKey'], (result) => {
                if (result.replacements && result.replacements.length > 0 && result.apiKey) {
                    processPage(result.replacements);
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
            chrome.storage.sync.get(['autoProcess', 'apiKey'], (result) => {
                if (result.autoProcess && changes.replacements.newValue.length > 0 && result.apiKey) {
                    processPage(changes.replacements.newValue);
                }
            });
        }
    }
});
})(); 