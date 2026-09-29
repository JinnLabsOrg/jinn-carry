/*
 * jinn-carry | server
 *
 * The server only relays a request from one client (the source) to another
 * client (the target). All of the heavy lifting / animation work happens on
 * the clients themselves, which keeps this fully standalone and framework
 * agnostic.
 *
 *  relay(targetSrc, action, payload)
 *      -> fires  jinn-carry:client:<action>  on the target client,
 *         passing the original sender id first, then the payload.
 */

// Actions a client is allowed to forward. Acts as a small whitelist so random
// clients cannot trigger arbitrary client events through this resource.
const ALLOWED_ACTIONS = new Set([
    'startCarried',   // begin being carried
    'beginCarrying',  // tell the carrier to start the carry animation
    'stopCarried',    // carrier cancelled -> target stand up
    'stopCarrying',   // carried cancelled -> carrier stop animation
    'goToTrunk',      // put target into a trunk
    'leaveTrunk',     // force target out of a trunk
    'goToSeat',       // warp target into a seat
    'leaveSeat',      // force target out of a seat
    'notify',         // simple notification
]);

onNet('jinn-carry:server:relay', (targetSrc, action, payload) => {
    const src = global.source;

    if (typeof targetSrc !== 'number' || !ALLOWED_ACTIONS.has(action)) {
        return;
    }

    // Make sure the target still exists before forwarding.
    if (GetPlayerName(targetSrc) === null) {
        return;
    }

    emitNet(`jinn-carry:client:${action}`, targetSrc, src, payload);
});
