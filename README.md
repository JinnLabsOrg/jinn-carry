# jinn-carry

A fully **standalone** carry / trunk / seat system for FiveM, written in **JavaScript**.
No framework required. Works on its own and optionally integrates with `qb-target` / `ox_target`.

## Features

- Carry the nearest player with a clean shoulder-carry animation
- Expandable carry styles — add as many as you want in `config.js`
- Each carry command is a **toggle** — run it once to carry, run it again to drop
- Carried player can free themselves with a keybind/command (configurable)
- Put any player into **any vehicle seat**
- Put any player into a vehicle **trunk**, plus get in / leave / remove
- Vehicle blacklist for trunk usage
- Vehicle lock checks
- `qb-target` and `ox_target` support with `autodetect`
- Optional on-foot text prompts (no target required)
- Optional `ox_lib` text UI / screen fade
- Fully synced through a lightweight, validated server relay

## Installation

1. Place the `jinn-carry` folder in your `resources` directory.
2. Add it to your `server.cfg`:

   ```cfg
   ensure jinn-carry
   ```

3. (Optional) If you set `Config.TextUI = 'ox_lib'` in `config.js`, uncomment the ox_lib
   line in `fxmanifest.lua`:

   ```lua
   shared_script '@ox_lib/init.lua'
   ```

## Files

```
jinn-carry/
├── fxmanifest.lua      Resource manifest
├── config.js           Shared config: settings, carry styles, language
├── README.md           This file
├── client/
│   └── client.js       Client logic: carry / trunk / seat, exports, target setup
└── server/
    └── server.js       Server logic: validated relay between clients
```

| File                | Side   | Purpose                                            |
| ------------------- | ------ | -------------------------------------------------- |
| `fxmanifest.lua`    | -      | Resource manifest                                  |
| `config.js`         | shared | All settings, carry styles, language               |
| `client/client.js`  | client | Carry / trunk / seat logic, exports, target setup  |
| `server/server.js`  | server | Validated relay between clients                    |

## Commands

| Command         | Default Key | Description                                     |
| --------------- | ----------- | ----------------------------------------------- |
| `/carry`        | `J`         | Carry the nearest person (toggle: carry / drop) |
| `/removetrunk`  | unbound     | Remove the person from the nearest trunk        |
| `/removeseat`   | unbound     | Remove the person from the nearest seat         |
| `/cancelcarry`  | `X`         | Cancel carry (works for carrier and carried)    |

> Commands are generated from `Config.CarryStyles`. By default there is one style
> (`/carry`). If you add more styles, each one gets its own `/carryN` command and keybind
> automatically.

Keybinds can be changed by each player under **Settings > Key Bindings > FiveM**.

## Configuration

All settings live in `config.js`. Key options:

| Option                         | Default        | Description                                                        |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| `Config.Target`                | `'autodetect'` | `'autodetect'` \| `'ox_target'` \| `'qb-target'` \| `'none'`       |
| `Config.TextUI`                | `'none'`       | `'ox_lib'` \| `'none'`                                             |
| `Config.EnableTextInteractions`| `false`        | Floating trunk prompts without a target system                     |
| `Config.CanCarriedPersonCancel`| `true`         | Allow the carried player to free themselves                        |
| `Config.DisallowDead`          | `false`        | `true` = dead players cannot be carried / trunked                  |
| `Config.EnablePutInSeat`       | `true`         | Allow placing a carried player into a seat                         |
| `Config.AllowPutInDriverSeat`  | `false`        | Allow using the driver seat                                        |
| `Config.EnablePutInTrunk`      | `true`         | Allow trunk interactions                                           |
| `Config.AllowMultipleInTrunk`  | `false`        | Allow more than one person per trunk                               |
| `Config.EnableCommands`        | `true`         | Register commands + keybinds                                       |
| `Config.EnableScreenFade`      | `false`        | Fade screen during interactions                                    |
| `Config.CheckVehicleLocked`    | `true`         | Block locked vehicles                                              |
| `Config.CarryDistance`         | `2.0`          | Max distance to carry a person                                     |
| `Config.VehicleDistance`       | `2.5`          | Max distance for vehicle interactions                              |
| `Config.DefaultVehicleTrunkNo` | `5`            | Default trunk door index                                           |
| `Config.VehicleTrunkModels`    | `{ sultan: 5 }`| Per-model trunk door index override                                |
| `Config.BlacklistVehicles`     | array          | Models blocked from trunk usage (lowercase names)                  |
| `Config.DisabledControls`      | array          | Control ids disabled while carrying / being carried                |

### Adding a new carry style

Append an object to `Config.CarryStyles`. Commands, keybinds, chat suggestions, and
target options are generated automatically from this list.

```js
{
    enabled: true,                // true = style works, false = fully disabled
    target: true,                 // true = show in target menu, false = command only
    id: 'carry6',                 // command name + keybind id (must be unique)
    label: 'My Custom Carry',     // shown in the target menu
    key: '',                      // default keybind ('' = unbound)
    carrying: {                   // animation for the person carrying
        dict: 'anim@heists@box_carry@',
        anim: 'idle',
        flag: 49,
    },
    carried: {                    // animation + position for the person carried
        dict: 'nm',
        anim: 'firemans_carry',
        flag: 33,
        attach: { x: 0.0, y: 0.0, z: 0.6 },   // offset relative to the carrier
        rotation: { x: 0.0, y: 0.0, z: 0.0 }, // pitch / roll / yaw
    },
}
```

> `attach` and `rotation` are visual. Tweak them in-game to line the peds up nicely.

### Enabling / disabling carry styles

Every style in `Config.CarryStyles` has two switches:

| Flag      | `true`                                              | `false`                                  |
| --------- | --------------------------------------------------- | ---------------------------------------- |
| `enabled` | Style works (command, keybind, and target)          | Fully disabled — no command, key, or target |
| `target`  | Shows in the qb-target / ox_target menu             | Command / keybind only, hidden from target |

Examples:

```js
// On, command + keybind + target menu
{ enabled: true,  target: true,  id: 'carry',  ... }

// On, but only via command / keybind (not shown in the target menu)
{ enabled: true,  target: false, id: 'carry2', ... }

// Completely turned off
{ enabled: false, target: false, id: 'carry3', ... }
```

> `target` only matters when `Config.Target` is set to `ox_target`, `qb-target`, or is
> auto-detected. If `Config.Target = 'none'`, no target menu is created at all.

## Player State

These replicated StateBag flags are set on the local player and can be read from any
resource using `Player(serverId).state` (or `LocalPlayer.state` locally):

| State                       | Description                                  |
| --------------------------- | -------------------------------------------- |
| `LocalPlayer.state.carrying`| `true` if you are carrying someone           |
| `LocalPlayer.state.carried` | `true` if you are being carried              |
| `LocalPlayer.state.intrunk` | `true` if you are inside a trunk             |
| `LocalPlayer.state.seated`  | `true` if you were placed into a seat        |

The vehicle's current trunk occupant (server id, or `false`) is stored on the vehicle:

```js
const occupant = Entity(vehicleEntity).state.trunkOccupant;
```

## Exports (client-side)

All exports are client-side. Call them from any resource as
`exports['jinn-carry']:ExportName(...)` (Lua) or
`exports['jinn-carry'].ExportName(...)` (JS).

### CarryPerson(styleIndex)

Carries the nearest player. If you are already carrying someone, calling it again
**drops** them (toggle). `styleIndex` is optional and maps to `Config.CarryStyles`
(`0` = first style). Defaults to `0`.

```lua
-- Lua
exports['jinn-carry']:CarryPerson()    -- default shoulder carry
exports['jinn-carry']:CarryPerson(1)   -- piggyback
```

```js
// JavaScript
exports['jinn-carry'].CarryPerson();
exports['jinn-carry'].CarryPerson(1);
```

### CancelCarry()

Cancels any ongoing carry — whether you are carrying or being carried. If you are in a
trunk, it makes you leave the trunk.

```lua
exports['jinn-carry']:CancelCarry()
```

### PutInClosestSeat(vehicleEntity)

Places the player you are carrying into the nearest free seat of the given vehicle.
Requires you to currently be carrying someone.

```lua
exports['jinn-carry']:PutInClosestSeat(vehicleEntity)
```

| Parameter       | Type   | Description                |
| --------------- | ------ | -------------------------- |
| `vehicleEntity` | number | Target vehicle entity id   |

### RemoveSeat()

Removes a player that was placed into a seat from the nearest vehicle (and removes you
if you were the one seated).

```lua
exports['jinn-carry']:RemoveSeat()
```

### PutInTrunk(vehicleEntity)

Puts the player you are carrying into the trunk of the given vehicle. Requires you to be
carrying someone, and the trunk must be open, unlocked, not blacklisted, and not full.

```lua
exports['jinn-carry']:PutInTrunk(vehicleEntity)
```

### GetInTrunk(vehicleEntity)

Puts **you** into the trunk of the given vehicle (no carrying required).

```lua
exports['jinn-carry']:GetInTrunk(vehicleEntity)
```

### LeaveTrunk(vehicleEntity)

Makes you leave the trunk. The `vehicleEntity` is optional — if omitted, the trunk you
are currently inside is used.

```lua
exports['jinn-carry']:LeaveTrunk(vehicleEntity)
exports['jinn-carry']:LeaveTrunk()            -- current trunk
```

### RemoveTrunk(vehicleEntity)

Removes the person currently inside the trunk. The `vehicleEntity` is optional — if
omitted, the nearest vehicle is used.

```lua
exports['jinn-carry']:RemoveTrunk(vehicleEntity)
exports['jinn-carry']:RemoveTrunk()           -- nearest vehicle
```

## Permission hooks

For server-side rules (jobs, permissions, etc.) edit these functions near the top of the
actions block in `client.js`. Return `false` to block the action:

```js
function CanBeCarried()      { return true; }   // can this player be carried?
function CanPutInSeat(seat)  { return true; }   // can the carried player go in this seat?
function CanPutInTrunk()     { return true; }   // can the carried player go in the trunk?
```

## Notes

- The carrier drives every interaction; the carried player performs the actual attach /
  animation on their own client when they receive the relayed event.
- The server only relays whitelisted actions between clients, keeping it framework
  agnostic and avoiding arbitrary client event triggers.
- Always validate `vehicleEntity` before passing it to trunk / seat exports.
- Carry-style animations for styles 2–5 ship with sensible defaults; attach offsets are
  visual and may need small per-server tweaks. Style 1 (shoulder) is the tested classic.
