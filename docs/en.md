# Legrand eco-meter

This integration reads the Legrand eco-meter (ref. 412000) directly on your local network, with no account and no third-party service. The device exposes two HTTP endpoints (`/inst.json` and `/data.json`) that the integration polls at a configurable interval.

## What shows up in Gladys

- **Instantaneous power of the 5 measurement channels**, in watts. Feature names come from the labels you set in the eco-meter's own interface: if input 1 is named "Heating" there, it is named "Heating" in Gladys.
- **Meter indexes** read from the teleinformation stream: off-peak and peak, or the base index depending on your tariff option (detected automatically). Reported in kWh.
- **Pulse inputs** (gas, water): only the ones enabled on the device are created, with their volume in m³.

## Configuration

1. Give the eco-meter a fixed DHCP lease on your router. Its address is used as the device identifier: changing it would create a new device in Gladys.
2. Enter that address in the configuration field (for example `192.168.1.140`).
3. Adjust the refresh interval if needed (60 seconds by default, 10 seconds minimum).
4. Use the **Test the connection** button to check that the device answers before running a discovery.

## Notes

- The eco-meter returns its indexes with leading zeros, which is not valid JSON; the integration normalizes the payload before parsing it.
- Channel labels are re-read on every discovery: rename an input on the eco-meter, run a discovery again, and the names are updated in Gladys.
- An unwired channel reports 0 W permanently. You can delete the matching feature in Gladys if it gets in the way.
