/*
 * jinn-carry | configuration
 * Shared script. All values are exposed on the global object so both
 * client.js and server.js can read them.
 */

// eslint-disable-next-line no-global-assign
Config = {};

// Target system: 'autodetect' | 'ox_target' | 'qb-target' | 'none'
Config.Target = 'autodetect';

// Text UI used by ShowText(): 'ox_lib' | 'none'
// If you switch this to 'ox_lib' remember to uncomment the ox_lib line in fxmanifest.lua
Config.TextUI = 'ox_lib'

// Show floating text prompts near vehicle trunks (true) or rely only on target/commands (false)
Config.EnableTextInteractions = false;

// Allow the carried person to free themselves with the cancel keybind/command
Config.CanCarriedPersonCancel = true;

// true  -> dead players can NOT be carried / put in trunk
// false -> dead players are allowed
Config.DisallowDead = false;

// Allow placing a carried player into a vehicle seat
Config.EnablePutInSeat = true;

// Allow placing a carried player into the driver seat
Config.AllowPutInDriverSeat = false;

// Allow placing / getting people into a vehicle trunk
Config.EnablePutInTrunk = true;

// Allow more than one person inside a single trunk at the same time
Config.AllowMultipleInTrunk = false;

// Register /carry, /removetrunk, /removeseat, /cancelcarry and their keybinds
Config.EnableCommands = true;

// Fade the screen in/out during interactions
Config.EnableScreenFade = false;

// Honour locked vehicles (you cannot use a locked vehicle)
Config.CheckVehicleLocked = true;

// Distances (in meters)
Config.CarryDistance = 2.0;
Config.VehicleDistance = 2.5;

// Default trunk door index used by GetVehicleDoorAngleRatio
Config.DefaultVehicleTrunkNo = 5;

// Per model override of the trunk door index (use lowercase model name)
Config.VehicleTrunkModels = {
    sultan: 5,
};

/*
 * Carry styles.
 *
 * Each style is its own command (id) and target option (label).
 *   enabled  -> true  = this carry style works (command, keybind, target).
 *               false = fully disabled (no command, no keybind, no target).
 *   target   -> true  = show this style in the qb-target / ox_target menu.
 *               false = command / keybind only, hidden from the target menu.
 *               (Only matters when Config.Target is not 'none'.)
 *   id       -> command name + keybind name ('carry', 'carry2', ...)
 *   label    -> shown in the qb/ox target menu
 *   key      -> default keybind for the command ('' = unbound)
 *   carrying -> animation played on the person doing the carrying
 *   carried  -> animation + attach offset for the person being carried
 *
 * attach  = where the carried ped sits relative to the carrier
 * rotation = pitch/roll/yaw of the carried ped
 *
 * Offsets are visual, tweak them per style to line the peds up nicely.
 */
Config.CarryStyles = [
    {
        enabled: true,   // [true = on, false = off]
        target: true,    // [true = show in target menu, false = command only]
        id: 'carry',
        label: 'Shoulder Carry',
        key: 'J',
        carrying: { dict: 'missfinale_c2mcs_1', anim: 'fin_c2_mcs_1_camman', flag: 49 },
        carried: {
            dict: 'nm', anim: 'firemans_carry', flag: 33,
            attach: { x: 0.27, y: 0.15, z: 0.63 },
            rotation: { x: 0.5, y: 0.5, z: 0.0 },
        },
    },
];

// Trunk animation + attach offset
Config.Animations = {
    intrunk: {
        dict: 'timetable@floyd@cryingonbed@base',
        anim: 'base',
        flag: 1,
        // Offsets are measured from the REAR of the vehicle (auto-scales per car):
        //   y = meters forward from the rear bumper into the trunk (higher = deeper in)
        //   z = height above the vehicle floor (lower = sits deeper down)
        //   x = sideways offset
        attach: { x: 0.0, y: 0.55, z: 0.25 },
        rotation: { x: 0.0, y: 0.0, z: 0.0 },
    },
};

// Models that can NOT be used for trunk interactions (lowercase model names)
Config.BlacklistVehicles = [
    'ardent', 'zentorno', 'surge', 'iwagen', 'voltic', 'voltic2', 'raiden',
    'cyclone', 'tezeract', 'neon', 'omnisegt', 'caddy', 'caddy2', 'caddy3',
    'airtug', 'rcbandito', 'imorgon', 'dilettante', 'khamelion', 'wheelchair',
    'bmx', 'tribike', 'tribike2', 'tribike3', 'fixter', 'cruiser', 'scorcher',
];

// Control ids disabled while carrying / being carried.
// Movement controls are intentionally left enabled so the carrier can still walk.
Config.DisabledControls = [
    24,   // Attack
    25,   // Aim
    37,   // Select weapon wheel
    44,   // Cover
    45,   // Reload
    47,   // Detonate / weapon
    140, 141, 142, 143, // Melee combo
    257,  // Attack 2
    263,  // Melee attack
    264,  // Melee
    23,   // Enter vehicle (only matters for carried)
    75,   // Exit vehicle
];

// eslint-disable-next-line no-global-assign
Language = {
    vehicle_locked: 'Vehicle is locked',
    cannot_put_in_vehicle: 'Cannot put in vehicle',
    cannot_be_carried: 'This person cannot be carried',
    no_one_nearby: 'There is no one near you to carry',
    no_vehicle_nearby: 'No vehicle nearby',
    trunk_closed: 'The trunk is closed',
    trunk_full: 'The trunk is full',
    trunk_blacklisted: 'You cannot use this trunk',
    no_free_seat: 'No free seat available',
    put_in_trunk: '~INPUT_DETONATE~ Put person in trunk',
    get_in_trunk: '~INPUT_VEH_HEADLIGHT~ Get inside trunk',
    leave_trunk: '~INPUT_DETONATE~ Leave trunk',
    remove_from_trunk: '~INPUT_DETONATE~ Remove person from trunk',
};
