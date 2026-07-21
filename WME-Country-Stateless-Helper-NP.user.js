// ==UserScript==
// @name         WME Country Stateless Helper NP
// @namespace    https://greasyfork.org/users/1087400
// @version      2.0.8
// @description  Detects when a Nepali city is assigned to a segment/venue and strips any auto-added state (e.g. Uttar Pradesh). Nepal has no states; this prevents cross-border state/country ID conflicts.
// @author       https://greasyfork.org/en/users/1087400-kid4rm90s
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @grant        GM_info
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @icon         https://www.google.com/s2/favicons?sz=64&domain=waze.com
// @require      https://greasyfork.org/scripts/560385/code/WazeToastr.js
// @downloadURL https://raw.githubusercontent.com/kid4rm90s/WME-Country-Stateless-Helper-NP/main/WME-Country-Stateless-Helper-NP.user.js
// @updateURL https://raw.githubusercontent.com/kid4rm90s/WME-Country-Stateless-Helper-NP/main/WME-Country-Stateless-Helper-NP.user.js
// ==/UserScript==

/* global getWmeSdk, WazeToastr */
(function () {
  'use strict';
    const updateMessage = `<strong>Version 2.0.8 - 2026-07-21:</strong><br>
    - Fixed issue with no-state ID resolution <br>`;
  const scriptName = GM_info.script.name;
  const scriptVersion = GM_info.script.version;
  const downloadUrl = 'https://raw.githubusercontent.com/kid4rm90s/WME-Country-Stateless-Helper-NP/main/WME-Country-Stateless-Helper-NP.user.js';
  const forumURL = 'https://github.com/kid4rm90s/WME-Country-Stateless-Helper-NP/issues';

  let wmeSDK;
  let nepalCountryId = null;
  /** State ID representing "no state" (default/empty state for countries without states) */
  let noStateId = null;
  /** Set of "dataModelName:objectId" keys currently being fixed — prevents re-entrant loops */
  const currentlyFixing = new Set();
  /** When true, checkAndFixAddress is bypassed to allow undo to complete */
  let suspendFixing = false;
  let resumeFixingTimeout = null;

  // ─── User Configuration ───────────────────────────────────────────────────

  const CONFIG = {
    // Set to true to enable debug console logging
    debug: false,
  };

  // ─── SDK Initialization ───────────────────────────────────────────────────

  /**
   * WME injects window.SDK_INITIALIZED (a Promise) on page load.
   * Wait for it, then call getWmeSdk() (which is synchronous).
   */
  (unsafeWindow || window).SDK_INITIALIZED.then(() => {
    wmeSDK = getWmeSdk({
      scriptId: 'StatelessHelperNP',
      scriptName: 'WME Country Stateless Helper NP',
    });
    bootstrap();
  });

  /**
   * Poll until the edit panel and top country are available,
   * then wait for wme-ready before full init.
   */
  function bootstrap() {
    // Check for UI and essential DataModel availability
    const topCountry = wmeSDK.DataModel.Countries.getTopCountry();
    const editPanel = document.getElementById('edit-panel');

    if (!editPanel || !topCountry) {
      setTimeout(bootstrap, 250);
      return;
    }

    // State.isReady() is a method, not a property — must call it
    if (wmeSDK.State.isReady()) {
      init();
    } else {
      wmeSDK.Events.once({ eventName: 'wme-ready' }).then(init);
    }
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  function init() {
    log('Ready');

    const countries = wmeSDK.DataModel.Countries.getAll();
    const nepal = countries.find((c) => c.name === 'Nepal');

    if (!nepal) {
      console.warn(`${scriptName}: Nepal not found. Ensure map is centered on Nepal.`);
      WazeToastr.Alerts.warning(scriptName, 'Nepal not found. Ensure map is centered on Nepal.', false, false, 5000);
      return;
    }
    nepalCountryId = nepal.id;

    resolveNoStateId();

    // Enable tracking for relevant models
    wmeSDK.Events.trackDataModelEvents({ dataModelName: 'segments' });
    wmeSDK.Events.trackDataModelEvents({ dataModelName: 'venues' });

    // Register event listeners
    wmeSDK.Events.on({ eventName: 'wme-data-model-objects-saved', eventHandler: handleObjectsSaved });
    wmeSDK.Events.on({ eventName: 'wme-data-model-objects-changed', eventHandler: handleObjectsChanged });

    // Undo/redo handling — allow undo to complete without re-fixing
    wmeSDK.Events.on({ eventName: 'wme-after-undo', eventHandler: handleAfterUndo });
    wmeSDK.Events.on({ eventName: 'wme-after-redo-clear', eventHandler: handleAfterRedoClear });

    // Future-proof check: Does Nepal now have its own states in WME?
    const nepalHasStates = wmeSDK.DataModel.States.hasNonDefaultStates() &&
      wmeSDK.DataModel.States.getAllWithoutDefault().some(s => s.countryId === nepalCountryId);

    console.info(`${scriptName}: Active — monitoring Nepal (ID ${nepalCountryId}). ${nepalHasStates ? 'States detected.' : 'Stateless mode: stripping auto-added states.'}`);
    WazeToastr.Alerts.info(scriptName, `Active — monitoring Nepal (ID ${nepalCountryId}). ${nepalHasStates ? 'States detected.' : 'Stateless mode: stripping auto-added states.'}`, false, false, 3000);

    scriptupdatemonitor();
  }

  // ─── State Lookup ─────────────────────────────────────────────────────────

  /**
   * Find the numeric ID of the "no-state" / default state.
   * Uses States.hasNonDefaultStates() as the fast path: if no non-default
   * states exist, the only state in getAll() IS the default ("no state").
   * Otherwise, the default is the one NOT in getAllWithoutDefault().
   */
  // function resolveNoStateId() {
  //   if (!wmeSDK.DataModel.States.hasNonDefaultStates()) {
  //     // No states defined anywhere — the only state is the default one
  //     const all = wmeSDK.DataModel.States.getAll();
  //     noStateId = all.length > 0 ? all[0].id : 0;
  //   } else {
  //     // Some countries have states; find the default (not in getAllWithoutDefault)
  //     const allStates = wmeSDK.DataModel.States.getAll();
  //     const nonDefault = wmeSDK.DataModel.States.getAllWithoutDefault();
  //     const nonDefaultIds = new Set(nonDefault.map((s) => s.id));
  //     const def = allStates.find((s) => !nonDefaultIds.has(s.id));

  //     // Fallback: look for a state with empty name (the "no state" placeholder)
  //     noStateId = def
  //       ? def.id
  //       : allStates.find((s) => !s.name || s.name === '')?.id ?? 0;
  //   }
  //   if (noStateId === 0) {
  //     console.warn(`${scriptName}: No-state ID resolved to 0 — unexpected. State stripping may be unreliable.`);
  //   }
  //   log(`No-state ID: ${noStateId}`);
  // }

    function resolveNoStateId() {
    const allStates = wmeSDK.DataModel.States.getAll();
    
    if (!wmeSDK.DataModel.States.hasNonDefaultStates()) {
      // No states defined anywhere — the only state in the model IS the default
      noStateId = allStates.length > 0 ? allStates[0].id : 1; // Defaulting to 1 based on observation
    } else {
      const nonDefault = wmeSDK.DataModel.States.getAllWithoutDefault();
      const nonDefaultIds = new Set(nonDefault.map((s) => s.id));
      
      // The default state is the one present in 'getAll' but NOT 'getAllWithoutDefault'
      const def = allStates.find((s) => !nonDefaultIds.has(s.id));

      noStateId = def
        ? def.id
        : allStates.find((s) => !s.name || s.name === '')?.id ?? 1;
    }

    if (noStateId === 0 || noStateId === null) {
      console.warn(`${scriptName}: No-state ID resolved to ${noStateId} — Check if map data is fully loaded.`);
      WazeToastr.Alerts.warning(scriptName, `No-state ID resolved to ${noStateId} — Check if map data is fully loaded.`, false, false, 5000);
    }
    log(`Resolved No-state ID: ${noStateId}`);
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  /**
   * Handle wme-data-model-objects-saved — fires after objects are committed
   * to the server. If a saved segment/venue has a Nepali city but a non-null
   * state, we fix the address and trigger a corrective save.
   */
  async function handleObjectsSaved(event) {
    const { dataModelName, objectIds } = event;

    if (dataModelName !== 'segments' && dataModelName !== 'venues') return;

    let needsFix = false;

    objectIds.forEach((objectId) => {
      if (checkAndFixAddress(dataModelName, objectId)) {
        needsFix = true;
      }
    });

    if (needsFix) {
      const pendingCount = wmeSDK.Editing.getUnsavedChangesCount();
      console.info(`${scriptName}: objects-saved cleanup — ${pendingCount} correction(s) pending. Saving...`);
      WazeToastr.Alerts.info(scriptName, `Corrections pending: ${pendingCount}. Saving...`, false, false, 3000);

      try {
        await wmeSDK.Editing.save();
        console.info(`${scriptName}: objects-saved cleanup — Corrective save successful.`);
        WazeToastr.Alerts.success(scriptName, 'Corrective save successful.', false, false, 3000);
      } catch (e) {
        console.error(`${scriptName}: objects-saved cleanup — Corrective save failed:`, e);
        WazeToastr.Alerts.error(scriptName, `Corrective save failed: ${e.message}`);
      }
    }
  }

  /**
   * Handle wme-data-model-objects-changed — fires when objects are modified
   * in the editor (before save). This is the primary defense, fixing the
   * address as soon as WME (or a script) incorrectly applies a state.
   */
  function handleObjectsChanged(event) {
    const { dataModelName, objectIds, objects } = event;

    if (dataModelName !== 'segments' && dataModelName !== 'venues') return;

    let fixCount = 0;

    objectIds.forEach((objectId) => {
      if (checkAndFixAddress(dataModelName, objectId)) {
        fixCount++;
      }
    });

    if (fixCount > 0) {
      console.info(`${scriptName}: objects-changed — Proactively intercepted ${fixCount} incorrect state(s).`);
      // WazeToastr.Alerts.info(scriptName, `Proactively intercepted ${fixCount} incorrect state(s).`, false, false, 3000);
    }
  }



  // ─── Core Logic ──────────────────────────────────────────────────────────

  /**
   * For a given segment or venue, read its current address.
   * If the country has no states defined but a state is set on the address,
   * strip it by setting stateId to the "no-state" default.
   *
   * @param {string} dataModelName - 'segments' | 'venues'
   * @param {string|number} objectId
   * @returns {boolean} true if a fix was applied
   */
  function checkAndFixAddress(dataModelName, objectId) {
    if (!nepalCountryId || noStateId === null) return false;

    // Allow undo to complete without re-fixing the address
    if (suspendFixing) return false;

    // Recursion guard: skip if we're already fixing this object
    const fixKey = `${dataModelName}:${objectId}`;
    if (currentlyFixing.has(fixKey)) return false;

    // Check if Nepal specifically has its own states — not whether any country does.
    // India (country ID 101) has states like Uttar Pradesh, but Nepal does not.
    if (wmeSDK.DataModel.States.hasNonDefaultStates() &&
        wmeSDK.DataModel.States.getAllWithoutDefault().some(s => s.countryId === nepalCountryId)) {
      return false;
    }

    currentlyFixing.add(fixKey);

    let address;
    const idValue = dataModelName === 'segments' ? Number(objectId) : String(objectId);

    try {
      address = dataModelName === 'segments'
        ? wmeSDK.DataModel.Segments.getAddress({ segmentId: idValue })
        : wmeSDK.DataModel.Venues.getAddress({ venueId: idValue });
    } catch (e) {
      console.info(`${scriptName}: Skip ${dataModelName} ${objectId}: getAddress failed (${e.message})`);
      currentlyFixing.delete(fixKey);
      return false;
    }

    // No address or empty — nothing to check
    if (!address || address.isEmpty) {
      console.info(`${scriptName}: Skip ${dataModelName} ${objectId}: no address`);
      currentlyFixing.delete(fixKey);
      return false;
    }

    // Determine if this address belongs to Nepal via direct countryId or city
    const addrCountryId = address.countryId ?? address.city?.countryId;
    if (!addrCountryId || addrCountryId !== nepalCountryId) {
      console.info(
        `${scriptName}: Skip ${dataModelName} ${objectId}: not in Nepal` +
          ` (countryId: ${addrCountryId ?? 'unknown'})`
      );
      currentlyFixing.delete(fixKey);
      return false;
    }

    console.info(
      `${scriptName}: ${dataModelName} ${objectId} current address:`,
      JSON.stringify(address, null, 2)
    );

    // No state set, or already set to no-state default — already correct
    if (!address.state || address.state.id === noStateId) {
      console.info(`${scriptName}: Skip ${dataModelName} ${objectId}: already correct`);
      currentlyFixing.delete(fixKey);
      return false;
    }

    // ── FIX NEEDED: state set on an address in a stateless country ──
    console.info(
      `${scriptName}: *** FIX TRIGGERED for ${dataModelName} ${objectId}` +
        ` — state "${address.state.name}" (ID ${address.state.id})` +
        ` set in stateless country, overriding with no-state (ID ${noStateId})`
    );
    WazeToastr.Alerts.info(scriptName,
      `Fix triggered for ${dataModelName}: state "${address.state.name}" → no-state.`,
      false, false, 4000);

    // Build addressData preserving existing data, setting state to no-state
    // stateId and cityName are both required for raw address updates (SDK v2.359+).
    // For empty/no-name cities, pass empty string as the error message instructs.
    const addressData = {
      countryId: nepalCountryId,
      stateId: noStateId,
      cityName: address.city?.name ?? '',
      streetName: address.street?.name ?? '',
      houseNumber: address.houseNumber ?? '',
    };

    // Preserve alternate street IDs for segments
    if (dataModelName === 'segments') {
      const seg = wmeSDK.DataModel.Segments.getById({ segmentId: idValue });
      if (seg?.alternateStreetIds?.length) {
        addressData.alternateStreetIds = seg.alternateStreetIds;
      }
    }

    try {
      if (dataModelName === 'segments') {
        wmeSDK.DataModel.Segments.updateAddress({ segmentId: idValue, addressData });
      } else {
        wmeSDK.DataModel.Venues.updateAddress({ venueId: idValue, addressData });
      }
      return true;
    } catch (e) {
      console.error(`${scriptName}: Failed to fix address for ${dataModelName} ${objectId}`, e);
      WazeToastr.Alerts.error(scriptName, `Failed to fix address for ${dataModelName} ${objectId}: ${e.message}`);
      return false;
    } finally {
      currentlyFixing.delete(fixKey);
    }
  }

  // ─── Undo / Redo Handlers ───────────────────────────────────────────────

  /**
   * After undo, briefly suspend fixing so the undo stack can complete.
   * Without this, our fix action is undone, then objects-changed fires,
   * and we re-fix immediately — making undo impossible.
   */
  function handleAfterUndo() {
    suspendFixing = true;
    clearTimeout(resumeFixingTimeout);
    resumeFixingTimeout = setTimeout(() => {
      suspendFixing = false;
    }, 500);
  }

  /**
   * After redo or undo-stack clear, resume fixing normally.
   * Scan all visible objects to reapply the state fix if needed.
   */
  function handleAfterRedoClear() {
    clearTimeout(resumeFixingTimeout);
    suspendFixing = false;

    // Re-scan all segments and venues on screen
    ['segments', 'venues'].forEach((model) => {
      const objects = model === 'segments'
        ? wmeSDK.DataModel.Segments.getAll()
        : wmeSDK.DataModel.Venues.getAll();
      objects.forEach((obj) => {
        const objectId = model === 'segments' ? obj.id : String(obj.id);
        checkAndFixAddress(model, objectId);
      });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function log(...args) {
    if (CONFIG.debug) {
      console.log(`${scriptName}:`, ...args);
    }
  }

    function scriptupdatemonitor() {
    if (WazeToastr?.Ready) {
      // Create and start the ScriptUpdateMonitor
      // For GitHub raw URLs, we need to specify metaUrl explicitly (same as downloadUrl for GitHub)
      const updateMonitor = new WazeToastr.Alerts.ScriptUpdateMonitor(
        scriptName,
        scriptVersion,
        downloadUrl,
        GM_xmlhttpRequest,
        downloadUrl, // metaUrl - for GitHub, use the same URL as it contains the @version tag
        /@version\s+(.+)/i, // metaRegExp - extracts version from @version tag
      );
      updateMonitor.start(2, true); // Check every 2 hours, check immediately

      // Show the update dialog for the current version
      WazeToastr.Interface.ShowScriptUpdate(scriptName, scriptVersion, updateMessage, downloadUrl, forumURL);
    } else {
      setTimeout(scriptupdatemonitor, 250);
    }
  }

})();

/*Changelog*/
/*
<strong>Version 2.0.8 - 2026-07-21:</strong><br>
    - Fixed issue with no-state ID resolution <br>
*/