/*
 * jinn-carry | client
 * Standalone JavaScript carry / trunk / seat system.
 *
 * Architecture:
 *   - The carrier drives every interaction and stores the server id of the
 *     person being handled (carryTargetSrc).
 *   - The person being handled performs the actual attach / animation on their
 *     own client when they receive a relayed event from the server.
 *   - Player StateBags (carrying / carried / intrunk / seated) keep every
 *     client in sync for target conditions and prompts.
 */

/* ------------------------------------------------------------------ *
 *  local state
 * ------------------------------------------------------------------ */

let carryTargetSrc = null;   // server id of the player I am carrying
let carriedBySrc = null;     // server id of the player carrying me
let currentTrunkVeh = null;  // vehicle entity I am currently inside the trunk of
let carryStyleIndex = 0;     // index into Config.CarryStyles for the active carry

let controlTick = null;
let carriedMonitor = null;
let trunkMonitor = null;
let seatMonitor = null;

const MY_SERVER_ID = () => GetPlayerServerId(PlayerId());

// Pre-hash the blacklist once for fast lookups.
const BLACKLIST = new Set(Config.BlacklistVehicles.map((name) => GetHashKey(name) >>> 0));

/* ------------------------------------------------------------------ *
 *  small helpers
 * ------------------------------------------------------------------ */

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function coordsOf(entity) {
    const c = GetEntityCoords(entity, true);
    return Array.isArray(c) ? c : [c.x, c.y, c.z];
}

function dist3(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function loadAnim(dict) {
    if (HasAnimDictLoaded(dict)) return true;
    RequestAnimDict(dict);
    let tries = 0;
    while (!HasAnimDictLoaded(dict) && tries < 100) {
        await delay(10);
        tries++;
    }
    return HasAnimDictLoaded(dict);
}

function relay(targetSrc, action, payload) {
    emitNet('jinn-carry:server:relay', targetSrc, action, payload);
}

function isDead() {
    return Config.DisallowDead && IsEntityDead(PlayerPedId());
}

function isBusy() {
    const s = LocalPlayer.state;
    return s.carrying || s.carried || s.intrunk || s.seated;
}

/* ------------------------------------------------------------------ *
 *  notifications / text
 * ------------------------------------------------------------------ */

function ShowNotify(text) {
    if (Config.TextUI === 'ox_lib' && GetResourceState('ox_lib') === 'started') {
        exports.ox_lib.notify({ description: text });
        return;
    }
    BeginTextCommandThefeedPost('STRING');
    AddTextComponentSubstringPlayerName(text);
    EndTextCommandThefeedPostTicker(false, true);
}

let showingText = null;
function ShowText(text) {
    if (Config.TextUI === 'ox_lib' && GetResourceState('ox_lib') === 'started') {
        if (showingText !== text) {
            showingText = text;
            exports.ox_lib.showTextUI(text);
        }
        return;
    }
    SetTextComponentFormat('STRING');
    BeginTextCommandDisplayHelp('STRING');
    AddTextComponentSubstringPlayerName(text);
    EndTextCommandDisplayHelp(0, false, true, -1);
}

function HideText() {
    if (Config.TextUI === 'ox_lib' && showingText !== null) {
        exports.ox_lib.hideTextUI();
        showingText = null;
    }
}

/* ------------------------------------------------------------------ *
 *  screen fade
 * ------------------------------------------------------------------ */

async function screenFadeOut() {
    if (!Config.EnableScreenFade) return;
    DoScreenFadeOut(350);
    let tries = 0;
    while (!IsScreenFadedOut() && tries < 20) {
        await delay(50);
        tries++;
    }
}

function screenFadeIn() {
    if (Config.EnableScreenFade) DoScreenFadeIn(350);
}

/* ------------------------------------------------------------------ *
 *  world lookups
 * ------------------------------------------------------------------ */

function getClosestPlayer(maxDist) {
    const myPed = PlayerPedId();
    const myCoords = coordsOf(myPed);
    let closest = -1;
    let closestDist = maxDist;

    for (const ply of GetActivePlayers()) {
        if (ply === PlayerId()) continue;
        const ped = GetPlayerPed(ply);
        if (!ped || ped === 0) continue;
        const d = dist3(myCoords, coordsOf(ped));
        if (d < closestDist) {
            closestDist = d;
            closest = ply;
        }
    }
    return closest;
}

function getClosestVehicle(maxDist) {
    const [x, y, z] = coordsOf(PlayerPedId());
    const veh = GetClosestVehicle(x, y, z, maxDist, 0, 70);
    return veh && veh !== 0 ? veh : null;
}

function getFreeSeat(vehicle) {
    const max = GetVehicleMaxNumberOfPassengers(vehicle);
    const start = Config.AllowPutInDriverSeat ? -1 : 0;
    for (let seat = start; seat < max; seat++) {
        if (IsVehicleSeatFree(vehicle, seat)) return seat;
    }
    return null;
}

/* ------------------------------------------------------------------ *
 *  vehicle / trunk helpers
 * ------------------------------------------------------------------ */

function getTrunkDoor(vehicle) {
    const model = GetEntityModel(vehicle) >>> 0;
    for (const name in Config.VehicleTrunkModels) {
        if ((GetHashKey(name) >>> 0) === model) return Config.VehicleTrunkModels[name];
    }
    return Config.DefaultVehicleTrunkNo;
}

function getTrunkAngle(vehicle) {
    return GetVehicleDoorAngleRatio(vehicle, getTrunkDoor(vehicle));
}

function isBlacklisted(vehicle) {
    return BLACKLIST.has(GetEntityModel(vehicle) >>> 0);
}

function isVehicleLocked(vehicle) {
    if (!Config.CheckVehicleLocked) return false;
    const status = GetVehicleDoorLockStatus(vehicle);
    return status !== 0 && status !== 1;
}

function isTrunkFull(vehicle) {
    if (Config.AllowMultipleInTrunk) return false;
    return !!Entity(vehicle).state.trunkOccupant;
}

function validTrunk(vehicle, notify) {
    if (!vehicle || vehicle === 0) {
        if (notify) ShowNotify(Language.no_vehicle_nearby);
        return false;
    }
    if (!Config.EnablePutInTrunk) return false;
    if (isBlacklisted(vehicle)) {
        if (notify) ShowNotify(Language.trunk_blacklisted);
        return false;
    }
    if (isVehicleLocked(vehicle)) {
        if (notify) ShowNotify(Language.vehicle_locked);
        return false;
    }
    if (getTrunkAngle(vehicle) <= 0.0) {
        if (notify) ShowNotify(Language.trunk_closed);
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ *
 *  control disabling + monitors
 * ------------------------------------------------------------------ */

function registerControlTick() {
    if (controlTick !== null) return;
    controlTick = setTick(() => {
        const list = Config.DisabledControls;
        for (let i = 0; i < list.length; i++) {
            DisableControlAction(0, list[i], true);
        }
    });
}

function clearControlTick() {
    const s = LocalPlayer.state;
    if (s.carrying || s.carried || s.intrunk) return; // still restricted
    if (controlTick !== null) {
        clearTick(controlTick);
        controlTick = null;
    }
}

function clearCarriedMonitor() {
    if (carriedMonitor !== null) {
        clearTick(carriedMonitor);
        carriedMonitor = null;
    }
}

function startCarriedMonitor() {
    clearCarriedMonitor();
    carriedMonitor = setTick(async () => {
        await delay(400);
        if (!LocalPlayer.state.carried) {
            clearCarriedMonitor();
            return;
        }
        if (isDead()) {
            if (carriedBySrc) relay(carriedBySrc, 'stopCarrying', null);
            stopBeingCarried();
            return;
        }
        const carrierPed = carriedBySrc ? GetPlayerPed(GetPlayerFromServerId(carriedBySrc)) : 0;
        if (!carrierPed || carrierPed === 0 || !DoesEntityExist(carrierPed)) {
            stopBeingCarried();
        }
    });
}

function clearTrunkMonitor() {
    if (trunkMonitor !== null) {
        clearTick(trunkMonitor);
        trunkMonitor = null;
    }
}

function startTrunkMonitor(vehicle) {
    clearTrunkMonitor();
    trunkMonitor = setTick(async () => {
        await delay(400);
        if (!LocalPlayer.state.intrunk) {
            clearTrunkMonitor();
            return;
        }
        if (!DoesEntityExist(vehicle) || GetVehicleEngineHealth(vehicle) < 100.0 || isDead()) {
            LeaveTrunk(vehicle);
        }
    });
}

function clearSeatMonitor() {
    if (seatMonitor !== null) {
        clearTick(seatMonitor);
        seatMonitor = null;
    }
}

function startSeatMonitor(vehicle) {
    clearSeatMonitor();
    seatMonitor = setTick(async () => {
        await delay(500);
        if (!LocalPlayer.state.seated) {
            clearSeatMonitor();
            return;
        }
        if (!IsPedInVehicle(PlayerPedId(), vehicle, false)) {
            LocalPlayer.state.set('seated', false, true);
            clearSeatMonitor();
        }
    });
}

/* ------------------------------------------------------------------ *
 *  low level attach / detach
 * ------------------------------------------------------------------ */

function detachSelf() {
    const myPed = PlayerPedId();
    DetachEntity(myPed, true, true);
    ClearPedTasks(myPed);
    SetEntityCollision(myPed, true, true);
}

async function playCarryAnim(styleIndex) {
    const myPed = PlayerPedId();
    const a = Config.CarryStyles[styleIndex].carrying;
    await loadAnim(a.dict);
    TaskPlayAnim(myPed, a.dict, a.anim, 8.0, -8.0, -1, a.flag, 0, false, false, false);
}

async function beCarried(carrierSrc, styleIndex) {
    carriedBySrc = carrierSrc;
    carryStyleIndex = styleIndex;
    LocalPlayer.state.set('carried', true, true);

    const myPed = PlayerPedId();
    const carrierPed = GetPlayerPed(GetPlayerFromServerId(carrierSrc));
    const a = Config.CarryStyles[styleIndex].carried;

    await screenFadeOut();
    await loadAnim(a.dict);

    AttachEntityToEntity(
        myPed, carrierPed, 0,
        a.attach.x, a.attach.y, a.attach.z,
        a.rotation.x, a.rotation.y, a.rotation.z,
        false, false, false, false, 2, true,
    );
    TaskPlayAnim(myPed, a.dict, a.anim, 8.0, -8.0, -1, a.flag, 0, false, false, false);

    registerControlTick();
    startCarriedMonitor();
    screenFadeIn();
}

// Detach a carried person locally without telling the carrier (used when the
// carry is being converted into a trunk/seat placement).
function cleanupCarried() {
    detachSelf();
    LocalPlayer.state.set('carried', false, true);
    clearCarriedMonitor();
    carriedBySrc = null;
    clearControlTick();
}

function stopBeingCarried() {
    detachSelf();
    LocalPlayer.state.set('carried', false, true);
    clearCarriedMonitor();
    carriedBySrc = null;
    clearControlTick();
    screenFadeIn();
}

function stopCarrying() {
    const myPed = PlayerPedId();
    const a = Config.CarryStyles[carryStyleIndex].carrying;
    StopAnimTask(myPed, a.dict, a.anim, 1.0);
    ClearPedTasks(myPed);
    LocalPlayer.state.set('carrying', false, true);
    carryTargetSrc = null;
    clearControlTick();
}

async function enterTrunk(vehicle) {
    if (!vehicle || vehicle === 0) return;
    currentTrunkVeh = vehicle;
    LocalPlayer.state.set('intrunk', true, true);

    const myPed = PlayerPedId();
    const a = Config.Animations.intrunk;

    // Attach to bone 0 (the chassis), NOT the 'boot' bone. The 'boot' bone is the
    // trunk lid and rotates up when the trunk is open, which would lift the ped out
    // and drape them over the lid. The chassis stays still, so the ped sits inside.
    // The spot is derived from the vehicle's model size so it scales to any car.
    const dims = GetModelDimensions(GetEntityModel(vehicle));
    const toArr = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
    const min = toArr(dims[0]);          // rear / bottom corner of the model
    const offX = a.attach.x;
    const offY = min[1] + a.attach.y;    // forward from the rear bumper into the trunk
    const offZ = a.attach.z;             // height above the vehicle origin

    await screenFadeOut();
    await loadAnim(a.dict);

    AttachEntityToEntity(
        myPed, vehicle, 0,
        offX, offY, offZ,
        a.rotation.x, a.rotation.y, a.rotation.z,
        false, false, false, false, 2, true,
    );
    TaskPlayAnim(myPed, a.dict, a.anim, 8.0, -8.0, -1, a.flag, 0, false, false, false);

    registerControlTick();
    startTrunkMonitor(vehicle);
    screenFadeIn();
}

function exitTrunk() {
    detachSelf();
    LocalPlayer.state.set('intrunk', false, true);
    clearTrunkMonitor();
    clearControlTick();
    currentTrunkVeh = null;
    screenFadeIn();
}

function leaveSeatSelf() {
    const myPed = PlayerPedId();
    const veh = GetVehiclePedIsIn(myPed, false);
    LocalPlayer.state.set('seated', false, true);
    clearSeatMonitor();
    if (veh && veh !== 0) TaskLeaveVehicle(myPed, veh, 0);
}

async function waitForNetVehicle(netId) {
    let tries = 0;
    while (!NetworkDoesNetworkIdExist(netId) && tries < 100) {
        await delay(15);
        tries++;
    }
    return NetworkGetEntityFromNetworkId(netId);
}

/* ------------------------------------------------------------------ *
 *  permission hooks (edit these to add your own server rules)
 * ------------------------------------------------------------------ */

function CanBeCarried() {
    // return false here to block someone from being carried
    return true;
}

function CanPutInSeat(seat) {
    if (!Config.AllowPutInDriverSeat && seat === -1) return false;
    return true;
}

function CanPutInTrunk() {
    return true;
}

/* ------------------------------------------------------------------ *
 *  public actions (also exported)
 * ------------------------------------------------------------------ */

function CarryPerson(style) {
    // Toggle: if I am already carrying, a second call drops the person.
    if (LocalPlayer.state.carrying) {
        CancelCarry();
        return;
    }
    if (isBusy() || isDead()) return;

    const idx = (typeof style === 'number' && Config.CarryStyles[style]) ? style : 0;
    if (!Config.CarryStyles[idx] || !Config.CarryStyles[idx].enabled) return; // style disabled
    const target = getClosestPlayer(Config.CarryDistance);
    if (target === -1) {
        ShowNotify(Language.no_one_nearby);
        return;
    }
    carryStyleIndex = idx;
    relay(GetPlayerServerId(target), 'startCarried', idx);
}

function CancelCarry() {
    const s = LocalPlayer.state;
    if (s.carrying && carryTargetSrc) {
        relay(carryTargetSrc, 'stopCarried', null);
        stopCarrying();
    } else if (s.carried && carriedBySrc) {
        if (!Config.CanCarriedPersonCancel) return;
        relay(carriedBySrc, 'stopCarrying', null);
        stopBeingCarried();
    } else if (s.intrunk) {
        LeaveTrunk(currentTrunkVeh);
    }
}

function PutInTrunk(vehicle) {
    if (!LocalPlayer.state.carrying || !carryTargetSrc) return;
    if (!validTrunk(vehicle, true)) return;
    if (isTrunkFull(vehicle)) {
        ShowNotify(Language.trunk_full);
        return;
    }
    if (!CanPutInTrunk()) return;

    const target = carryTargetSrc;
    const netId = NetworkGetNetworkIdFromEntity(vehicle);
    Entity(vehicle).state.set('trunkOccupant', target, true);
    stopCarrying();
    relay(target, 'goToTrunk', netId);
}

function GetInTrunk(vehicle) {
    if (isBusy()) return;
    if (!validTrunk(vehicle, true)) return;
    if (isTrunkFull(vehicle)) {
        ShowNotify(Language.trunk_full);
        return;
    }
    Entity(vehicle).state.set('trunkOccupant', MY_SERVER_ID(), true);
    enterTrunk(vehicle);
}

function LeaveTrunk(vehicle) {
    const veh = vehicle || currentTrunkVeh;
    if (!LocalPlayer.state.intrunk) return;
    if (veh && veh !== 0) Entity(veh).state.set('trunkOccupant', false, true);
    exitTrunk();
}

function RemoveTrunk(vehicle) {
    const veh = vehicle || getClosestVehicle(Config.VehicleDistance);
    if (!veh || veh === 0) {
        ShowNotify(Language.no_vehicle_nearby);
        return;
    }
    const occupant = Entity(veh).state.trunkOccupant;
    if (!occupant) return;

    if (occupant === MY_SERVER_ID()) {
        LeaveTrunk(veh);
        return;
    }
    Entity(veh).state.set('trunkOccupant', false, true);
    relay(occupant, 'leaveTrunk', null);
}

function PutInClosestSeat(vehicle) {
    if (!Config.EnablePutInSeat) return;
    if (!LocalPlayer.state.carrying || !carryTargetSrc) return;
    if (!vehicle || vehicle === 0) {
        ShowNotify(Language.no_vehicle_nearby);
        return;
    }
    if (isVehicleLocked(vehicle)) {
        ShowNotify(Language.vehicle_locked);
        return;
    }
    const seat = getFreeSeat(vehicle);
    if (seat === null || !CanPutInSeat(seat)) {
        ShowNotify(Language.no_free_seat);
        return;
    }
    const target = carryTargetSrc;
    const netId = NetworkGetNetworkIdFromEntity(vehicle);
    stopCarrying();
    relay(target, 'goToSeat', { netId, seat });
}

function RemoveSeat() {
    const veh = getClosestVehicle(Config.VehicleDistance);
    if (!veh || veh === 0) {
        ShowNotify(Language.no_vehicle_nearby);
        return;
    }
    // self first
    if (LocalPlayer.state.seated && IsPedInVehicle(PlayerPedId(), veh, false)) {
        leaveSeatSelf();
        return;
    }
    const max = GetVehicleMaxNumberOfPassengers(veh);
    for (let seat = -1; seat < max; seat++) {
        const ped = GetPedInVehicleSeat(veh, seat);
        if (!ped || ped === 0 || !IsPedAPlayer(ped)) continue;
        const src = GetPlayerServerId(NetworkGetPlayerIndexFromPed(ped));
        if (src === MY_SERVER_ID()) continue;
        if (Player(src).state.seated) {
            relay(src, 'leaveSeat', null);
            return;
        }
    }
}

/* ------------------------------------------------------------------ *
 *  relayed net events (received by the person being handled)
 * ------------------------------------------------------------------ */

onNet('jinn-carry:client:startCarried', async (carrierSrc, styleIndex) => {
    if (isBusy()) return;
    if (!CanBeCarried() || isDead()) {
        relay(carrierSrc, 'notify', Language.cannot_be_carried);
        return;
    }
    const idx = Config.CarryStyles[styleIndex] ? styleIndex : 0;
    await beCarried(carrierSrc, idx);
    relay(carrierSrc, 'beginCarrying', idx);
});

onNet('jinn-carry:client:beginCarrying', async (targetSrc, styleIndex) => {
    carryTargetSrc = targetSrc;
    carryStyleIndex = Config.CarryStyles[styleIndex] ? styleIndex : 0;
    LocalPlayer.state.set('carrying', true, true);
    await playCarryAnim(carryStyleIndex);
    registerControlTick();
});

onNet('jinn-carry:client:stopCarried', () => {
    // carrier cancelled -> I stand up
    if (LocalPlayer.state.carried) stopBeingCarried();
});

onNet('jinn-carry:client:stopCarrying', () => {
    // carried cancelled -> I stop carrying
    if (LocalPlayer.state.carrying) stopCarrying();
});

onNet('jinn-carry:client:goToTrunk', async (sender, netId) => {
    cleanupCarried();
    const veh = await waitForNetVehicle(netId);
    await enterTrunk(veh);
});

onNet('jinn-carry:client:leaveTrunk', () => {
    if (LocalPlayer.state.intrunk) exitTrunk();
});

onNet('jinn-carry:client:goToSeat', async (sender, payload) => {
    cleanupCarried();
    const veh = await waitForNetVehicle(payload.netId);
    if (!veh || veh === 0) return;
    TaskWarpPedIntoVehicle(PlayerPedId(), veh, payload.seat);
    LocalPlayer.state.set('seated', true, true);
    startSeatMonitor(veh);
});

onNet('jinn-carry:client:leaveSeat', () => {
    if (LocalPlayer.state.seated) leaveSeatSelf();
});

onNet('jinn-carry:client:notify', (sender, text) => {
    ShowNotify(text);
});

/* ------------------------------------------------------------------ *
 *  exports
 * ------------------------------------------------------------------ */

exports('CarryPerson', CarryPerson);
exports('CancelCarry', CancelCarry);
exports('PutInTrunk', PutInTrunk);
exports('GetInTrunk', GetInTrunk);
exports('LeaveTrunk', LeaveTrunk);
exports('RemoveTrunk', RemoveTrunk);
exports('PutInClosestSeat', PutInClosestSeat);
exports('RemoveSeat', RemoveSeat);

// clean up if the resource stops mid-interaction
on('onResourceStop', (resource) => {
    if (resource !== GetCurrentResourceName()) return;
    if (LocalPlayer.state.carried || LocalPlayer.state.intrunk) detachSelf();
    if (controlTick !== null) clearTick(controlTick);
    if (carriedMonitor !== null) clearTick(carriedMonitor);
    if (trunkMonitor !== null) clearTick(trunkMonitor);
    if (seatMonitor !== null) clearTick(seatMonitor);
});

/* ------------------------------------------------------------------ *
 *  commands + keybinds
 * ------------------------------------------------------------------ */

if (Config.EnableCommands) {
    // One command + keybind per ENABLED carry style. Each is a toggle:
    // run it once to carry, run it again to drop the person.
    Config.CarryStyles.forEach((style, index) => {
        if (!style.enabled) return; // disabled style -> no command / keybind
        RegisterCommand(style.id, () => CarryPerson(index), false);
        RegisterKeyMapping(style.id, `Carry: ${style.label}`, 'keyboard', style.key || '');
    });

    // Remove person from trunk
    RegisterCommand('removetrunk', () => RemoveTrunk(), false);
    RegisterKeyMapping('removetrunk', 'Remove person from trunk', 'keyboard', '');

    // Remove person from a seat
    RegisterCommand('removeseat', () => RemoveSeat(), false);
    RegisterKeyMapping('removeseat', 'Remove person from seat', 'keyboard', '');

    // Cancel carry (carrier or carried) - default X
    RegisterCommand('cancelcarry', () => CancelCarry(), false);
    RegisterKeyMapping('cancelcarry', 'Cancel carry', 'keyboard', 'X');

    setTimeout(() => {
        Config.CarryStyles.forEach((style) => {
            if (!style.enabled) return;
            emit('chat:addSuggestion', `/${style.id}`, `${style.label} (toggle to carry / drop)`);
        });
        emit('chat:addSuggestion', '/removetrunk', 'Remove a person from the nearest trunk');
        emit('chat:addSuggestion', '/removeseat', 'Remove a person from the nearest seat');
        emit('chat:addSuggestion', '/cancelcarry', 'Cancel an ongoing carry');
    }, 2000);
}

/* ------------------------------------------------------------------ *
 *  target integration (ox_target / qb-target)
 * ------------------------------------------------------------------ */

function resolveTarget() {
    if (Config.Target === 'autodetect') {
        if (GetResourceState('ox_target') === 'started') return 'ox_target';
        if (GetResourceState('qb-target') === 'started') return 'qb-target';
        return 'none';
    }
    return Config.Target;
}

function setupOxTarget() {
    const carryOptions = Config.CarryStyles
        .map((style, index) => ({ style, index }))
        .filter(({ style }) => style.enabled && style.target)
        .map(({ style, index }) => ({
            name: `jinn_${style.id}`,
            label: style.label,
            icon: 'fa-solid fa-hand-holding',
            distance: Config.CarryDistance,
            canInteract: () => !isBusy(),
            onSelect: () => CarryPerson(index),
        }));
    if (carryOptions.length > 0) exports.ox_target.addGlobalPlayer(carryOptions);

    exports.ox_target.addGlobalVehicle([
        {
            name: 'jinn_put_seat',
            label: 'Put in seat',
            icon: 'fa-solid fa-person-arrow-up-from-line',
            distance: Config.VehicleDistance,
            bones: ['seat_dside_f', 'seat_pside_f', 'seat_dside_r', 'seat_pside_r', 'seat_r'],
            canInteract: (entity) => Config.EnablePutInSeat && LocalPlayer.state.carrying && !isVehicleLocked(entity),
            onSelect: (data) => PutInClosestSeat(data.entity),
        },
        {
            name: 'jinn_remove_seat',
            label: 'Remove from seat',
            icon: 'fa-solid fa-person-arrow-down-to-line',
            distance: Config.VehicleDistance,
            bones: ['seat_dside_f', 'seat_pside_f', 'seat_dside_r', 'seat_pside_r', 'seat_r'],
            canInteract: (entity) => Config.EnablePutInSeat && !isVehicleLocked(entity),
            onSelect: () => RemoveSeat(),
        },
        {
            name: 'jinn_put_trunk',
            label: 'Put in trunk',
            icon: 'fa-solid fa-person-arrow-up-from-line',
            distance: Config.VehicleDistance,
            bones: ['boot', 'platelight', 'bonnet'],
            canInteract: (entity) => validTrunk(entity, false) && !isTrunkFull(entity) && LocalPlayer.state.carrying,
            onSelect: (data) => PutInTrunk(data.entity),
        },
        {
            name: 'jinn_get_trunk',
            label: 'Get in trunk',
            icon: 'fa-solid fa-person-arrow-up-from-line',
            distance: Config.VehicleDistance,
            bones: ['boot', 'platelight', 'bonnet'],
            canInteract: (entity) => validTrunk(entity, false) && !isTrunkFull(entity) && !isBusy(),
            onSelect: (data) => GetInTrunk(data.entity),
        },
        {
            name: 'jinn_leave_trunk',
            label: 'Leave trunk',
            icon: 'fa-solid fa-person-arrow-down-to-line',
            distance: Config.VehicleDistance,
            bones: ['boot', 'platelight', 'bonnet'],
            canInteract: (entity) => LocalPlayer.state.intrunk && Entity(entity).state.trunkOccupant === MY_SERVER_ID(),
            onSelect: (data) => LeaveTrunk(data.entity),
        },
        {
            name: 'jinn_remove_trunk',
            label: 'Remove from trunk',
            icon: 'fa-solid fa-person-arrow-down-to-line',
            distance: Config.VehicleDistance,
            bones: ['boot', 'platelight', 'bonnet'],
            canInteract: (entity) => !!Entity(entity).state.trunkOccupant && !LocalPlayer.state.intrunk && !isVehicleLocked(entity),
            onSelect: (data) => RemoveTrunk(data.entity),
        },
    ]);
}

function setupQbTarget() {
    const carryOptions = Config.CarryStyles
        .map((style, index) => ({ style, index }))
        .filter(({ style }) => style.enabled && style.target)
        .map(({ style, index }) => ({
            label: style.label,
            icon: 'fa-solid fa-hand-holding',
            canInteract: () => !isBusy(),
            action: () => CarryPerson(index),
        }));
    if (carryOptions.length > 0) {
        exports['qb-target'].AddGlobalPlayer({
            options: carryOptions,
            distance: Config.CarryDistance,
        });
    }

    exports['qb-target'].AddTargetBone(['seat_dside_f', 'seat_pside_f', 'seat_dside_r', 'seat_pside_r', 'seat_r'], {
        options: [
            {
                label: 'Put in seat',
                icon: 'fa-solid fa-person-arrow-up-from-line',
                canInteract: (entity) => Config.EnablePutInSeat && LocalPlayer.state.carrying && !isVehicleLocked(entity),
                action: (entity) => PutInClosestSeat(entity),
            },
            {
                label: 'Remove from seat',
                icon: 'fa-solid fa-person-arrow-down-to-line',
                canInteract: (entity) => Config.EnablePutInSeat && !isVehicleLocked(entity),
                action: () => RemoveSeat(),
            },
        ],
        distance: Config.VehicleDistance,
    });

    exports['qb-target'].AddTargetBone(['boot', 'bonnet', 'platelight'], {
        options: [
            {
                label: 'Put in trunk',
                icon: 'fa-solid fa-person-arrow-up-from-line',
                canInteract: (entity) => validTrunk(entity, false) && !isTrunkFull(entity) && LocalPlayer.state.carrying,
                action: (entity) => PutInTrunk(entity),
            },
            {
                label: 'Get in trunk',
                icon: 'fa-solid fa-person-arrow-up-from-line',
                canInteract: (entity) => validTrunk(entity, false) && !isTrunkFull(entity) && !isBusy(),
                action: (entity) => GetInTrunk(entity),
            },
            {
                label: 'Leave trunk',
                icon: 'fa-solid fa-person-arrow-down-to-line',
                canInteract: (entity) => LocalPlayer.state.intrunk && Entity(entity).state.trunkOccupant === MY_SERVER_ID(),
                action: (entity) => LeaveTrunk(entity),
            },
            {
                label: 'Remove from trunk',
                icon: 'fa-solid fa-person-arrow-down-to-line',
                canInteract: (entity) => !!Entity(entity).state.trunkOccupant && !LocalPlayer.state.intrunk && !isVehicleLocked(entity),
                action: (entity) => RemoveTrunk(entity),
            },
        ],
        distance: Config.VehicleDistance,
    });
}

setTimeout(() => {
    const target = resolveTarget();
    Config.Target = target;
    if (target === 'ox_target') setupOxTarget();
    else if (target === 'qb-target') setupQbTarget();
}, 1500);

/* ------------------------------------------------------------------ *
 *  text interactions (optional, no target required)
 *  Controls: 47 = G (put / leave / remove), 74 = H (get in trunk)
 * ------------------------------------------------------------------ */

if (Config.EnableTextInteractions && Config.EnablePutInTrunk) {
    setTick(async () => {
        let wait = 800;
        const myPed = PlayerPedId();

        if (!IsPedInAnyVehicle(myPed, false)) {
            const vehicle = getClosestVehicle(Config.VehicleDistance);

            if (vehicle && !isBlacklisted(vehicle)) {
                let bone = GetEntityBoneIndexByName(vehicle, 'boot');
                if (bone === -1) bone = GetEntityBoneIndexByName(vehicle, 'platelight');
                const trunkPos = bone !== -1 ? GetWorldPositionOfEntityBone(vehicle, bone) : coordsOf(vehicle);
                const trunkArr = Array.isArray(trunkPos) ? trunkPos : [trunkPos.x, trunkPos.y, trunkPos.z];
                const d = dist3(coordsOf(myPed), trunkArr);

                if (d < 1.6 && getTrunkAngle(vehicle) > 0.0) {
                    wait = 0;
                    const occupant = Entity(vehicle).state.trunkOccupant;

                    if (isVehicleLocked(vehicle)) {
                        ShowText(Language.vehicle_locked);
                    } else if (LocalPlayer.state.intrunk) {
                        ShowText(Language.leave_trunk);
                        if (IsDisabledControlJustReleased(0, 47)) LeaveTrunk(vehicle);
                    } else if (LocalPlayer.state.carrying) {
                        ShowText(Language.put_in_trunk);
                        if (IsDisabledControlJustReleased(0, 47)) PutInTrunk(vehicle);
                    } else if (occupant) {
                        ShowText(Language.remove_from_trunk);
                        if (IsDisabledControlJustReleased(0, 47)) RemoveTrunk(vehicle);
                    } else {
                        ShowText(Language.get_in_trunk);
                        if (IsDisabledControlJustReleased(0, 74)) GetInTrunk(vehicle);
                    }
                } else {
                    HideText();
                }
            } else {
                HideText();
            }
        } else {
            HideText();
        }

        await delay(wait);
    });
}
