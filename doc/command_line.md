# Command line usage

> [!NOTE]
> By default command line is protected by a password, see [configuration](doc/configuration.md#main-parameters) to change this password.

## Help

After login to command line, you can access different commands explained below.
The command `help` permits to display all commands available in running firmware.
```
help  [<string>] [-v <0|1>]
  Print the summary of all registered commands if no arguments are given,
  otherwise print summary of given command.
      <string>  Name of command
  -v, --verbose=<0|1>  If specified, list console commands with given verbose level
```

## Misc commands

### Reboot
```
reboot 
  Reboot ESP32
```
### Logout
```
logout 
  Logout from ESP32 console
```

## Configuration commands

### Configure command line password
```
config_password  [-d] [--pass=<password>]
  Configure console password (change is applied immediately)
  -d, --delete  Delete current configuration in storage (no other argument required)
  --pass=<password>  Password (up to 32 characters)
```

### Configure Wifi
```
config_wifi  [-rd] [--ssid=<SSID>] [--pwd=<password>] [--saemode=<SAE mode>] [--saepwid=<SAE pass>] [--auth=<threshold>]
  Configure Wifi (changes are applied after reboot)
    -r, --read  Read current configuration from storage (no other argument required)
  -d, --delete  Delete current configuration in storage (no other argument required)
  --ssid=<SSID>  Wifi SSID
  --pwd=<password>  Wifi password
  --saemode=<SAE mode>  Integer value: 1 = HUNT AND PECK, 2 = H2E, 3 = BOTH
  --saepwid=<SAE pass>  SAE password identifier
  --auth=<threshold>  Authentication threshold: OPEN, WEP, WPA-PSK, WPA/WPA2-PSK, WPA2-PSK, WAPI-PSK, WPA2/WPA3-PSK, WPA3-PSK
```

### Configure network
```
config_network  [-rd] [--hostname=<hostname>] [--dhcp=<dhcp>] [--ip=<address>] [--mask=<netmask>] [--gateway=<gateway>] [--dns1=<DNS1 address>] [--dns2=<DNS2 address>] [--ntp=<NTP address>]
  Configure Network (changes are applied after reboot)
    -r, --read  Read current configuration from storage (no other argument required)
  -d, --delete  Delete current configuration in storage (no other argument required)
  --hostname=<hostname>  ESP32 hostname
  --dhcp=<dhcp>  1 to enabled DHCP, 0 to disable (static IP)
  --ip=<address>  ESP32 IPv4 address for static configuration
  --mask=<netmask>  Network mask for static configuration
  --gateway=<gateway>  Gateway IPv4 address for static configuration
  --dns1=<DNS1 address>  Main DNS server address for static configuration
  --dns2=<DNS2 address>  Backup DNS server address for static configuration
  --ntp=<NTP address>  NTP server address (eg pool.ntp.org)
```

### Configure MQTT client
```
config_mqtt  [-rd] [--state=<state>] [--addr=<address>] [--port=<port>] [--id=<client_id>] [--user=<username>] [--pass=<password>] [--tls=<tls_state>] [--cert=<certificate>] [--topic=<topic_prefix>] [--discovery=<discovery_prefix>]
  Configure MQTT (changes are applied after reboot)
    -r, --read  Read current configuration from storage (no other argument required)
  -d, --delete  Delete current configuration in storage (no other argument required)
  --state=<state>  1 to enable MQTT client, 0 to disable
  --addr=<address>  Broker address to connect to
  --port=<port>  Broker port to connect to
  --id=<client_id>  Client unique ID when connecting to MQTT broker
  --user=<username>  Client username when connecting to MQTT broker
  --pass=<password>  Client password when connecting to MQTT broker
  --tls=<tls_state>  1 to enable TLS connection to MQTT broker, 0 to disable
  --cert=<certificate>  MQTT broker certificate (content of .pem file without --- BEGIN CERTIFICATE --- and ---END CERTIFICATE ---)
  --topic=<topic_prefix>  Prefix added before all MQTT topics except discovery
  --discovery=<discovery_prefix>  Prefix added before discovery topic. Discovery topic will be <discovery_prefix>/config
```

##  IO related commands

### IO configuration
```
io_config  [-rd] [--logging=<state>] [--passive=<state>] [--key=<system key>] [--id=<node ID>] [--power=<power>] [--ignoreautoupdate=<state>]
  Configure IO layer
    -r, --read  Read current configuration from storage (no other argument required)
  -d, --delete  Delete current configuration in storage (no other argument required)
  --logging=<state>  1 to enable logging in IO HomeControl layer, 0 to disable
  --passive=<state>  1 to enable passive state in IO HomeControl layer, 0 to disable
  --key=<system key>  IO System key (string representation of 16 bytes)
  --id=<node ID>  Board Node ID (string representation of 3 bytes, eg 112233)
  --power=<power>  Tx power (range 0-20)
  --ignoreautoupdate=<state>  1 to ignore auto-update flag and use timer value, 0 to trust auto-update
```

### Discover and pair a device
> [!NOTE]
> Device must be set in pairing mode before launching the command. If device has already been paired to a 2W controller in the past and you don't know the key, you will have to reset the device to factory settings (check your device documentation). If device is already paired and you know the key, use the io_add command below.
```
io_discover 
  Try to find and pair an IO-HomeControl device in pairing mode and never
  registered
```

### Add an already paired device
> [!NOTE]
> Device must be already paired with a known key (and key must be set in this board) before launching the command. If device has already been paired to a 2W controller in the past and you don't know the key, you will have to reset the device to factory settings (check your device documentation). If device is not yet paired, use the io_discover command.
```
io_add  <deviceid>
  Add an already registered IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Remove an existing device
```
io_remove  <deviceid>
  Remove an already added IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### List IO devices currently registered.
```
io_listdevices 
  List IO devices currently registered.
```

### Identify an IO-HomeControl device
Device will physically identify itself e.g., brief jog movement
```
io_identify  <deviceid>
  Identify an IO-HomeControl device (device will physically identify itself,
  e.g., brief jog movement)
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Open (or set to 'On') an IO-HomeControl device
```
io_open  <deviceid>
  Open (or set to 'On') an IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Close (or set to 'Off') an IO-HomeControl device
```
io_close  <deviceid>
  Close (or set to 'Off') an IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Stop a currently moving IO-HomeControl device
```
io_stop  <deviceid>
  Stop a currently moving IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Set an IO-HomeControl device to favorite position (like 'My' button)
```
io_setfavpos  <deviceid>
  Set an IO-HomeControl device to favorite position (like 'My' button)
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Set an IO-HomeControl device to a specified position
> [!NOTE]
> Only supported by devices with position (eg switch only support position 0 and 100)
```
io_setpos  <deviceid> <position>
  Set an IO-HomeControl device to a specified position
    <deviceid>  ID of the device, 3 bytes (eg 112233)
    <position>  Specify the position to reach (0 = OPEN to 100 = CLOSED)
```

### Set an IO-HomeControl device to a specified tilt angle
> [!NOTE]
> Only supported by devices with tilt
```
io_tilt  <deviceid> <tilt>
  Set an IO-HomeControl device to a specified tilt angle
    <deviceid>  ID of the device, 3 bytes (eg 112233)
        <tilt>  Specify the tilt (0 = CLOSED to 100 = OPEN)
```

### Force status update for a given IO-HomeControl device
```
io_update  <deviceid>
  Force status update for a given IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Set a new name inside IO-HomeControl device configuration
```
io_setname  <deviceid> <name>
  Set a new name inside IO-HomeControl device configuration
    <deviceid>  ID of the device, 3 bytes (eg 112233)
        <name>  Name of the device, 1 to 15 characters
```

### Link a remote to a IO-HomeControl device
```
io_linkremote  <deviceid> <remoteid>
  Link a remote to a IO-HomeControl device
    <deviceid>  ID of the device, 3 bytes (eg 112233)
    <remoteid>  ID of the remote, 3 bytes (eg AABBCC)
```

### Remove an IO remote
```
io_removeremote  <remoteid>
  Remove an IO remote
    <remoteid>  ID of the remote, 3 bytes (eg AABBCC)
```

### Configure IO-HomeControl device to send its status automatically (not supported by all devices)
```
io_devicefeedback  <deviceid>
  Configure IO-HomeControl device to send its status automatically (not supported by all devices)
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Configure IO-HomeControl device to invert OPEN and CLOSE commands

```
io_invertdevice  <deviceid>
  Configure IO-HomeControl device to invert OPEN and CLOSE commands
    <deviceid>  ID of the device, 3 bytes (eg 112233)
```

### Send an IO frame from given string representation and frequency
```
io_sendraw  <raw frame> <frequency>
  Send an IO frame from given string representation and frequency, waits for
  response if relevant (no 'end' flag), manages authentication.
   <raw frame>  String representation of an IO frame from CTRL0 to end of data (without CRC), 9 to 36 bytes.
   <frequency>  frequency in Hz (868950000 to send on channel 2)
```
