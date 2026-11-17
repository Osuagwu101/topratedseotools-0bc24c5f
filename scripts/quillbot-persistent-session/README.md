# Persistent QuillBot sign-in

The dedicated native browser profile is the renewable sign-in. An imported ID-token cookie is not a substitute for that profile. The relay retains IndexedDB/localStorage, binds refreshed tokens to the account assigned by Admin, and checks native token freshness every five minutes.

The private relay exposes bearer-authenticated `/status` and `/renew` endpoints on loopback only. They report timestamps and health, never token values. `renewedBeyondImported` becomes true only when a native token for the assigned account expires more than one minute after the imported token. This proves a renewal interval; it is not evidence of seven days of uptime. Logs in `trst-quillbot-native-relay.service` retain health observations for the operator to review.

## Installation

Run `python3 scripts/quillbot-persistent-session/install.py` from the reviewed release on the server. This installs the monitor and initializes the account binding from the encrypted Admin vault. It restarts the relay only and retains the native browser/profile.

## One-time owner login

Run `python3 scripts/quillbot-persistent-session/open-private-login.py` on the server. It starts temporary, unprivileged VNC and noVNC processes listening exclusively on loopback, with a one-hour lifetime. They display only the dedicated QuillBot browser.

On the owner's Windows device, forward `127.0.0.1:16966` through the authorized SSH connection to server `127.0.0.1:6096`, with `ExitOnForwardFailure=yes`. Open `http://127.0.0.1:16966/vnc.html?autoconnect=1&resize=scale` in the connected Chrome and let the owner complete QuillBot's normal sign-in. Do not collect passwords or verification codes in chat. Do not publish the display through Nginx or open a public VNC port.

After sign-in, verify Premium and the assigned account, close the temporary display using `close-private-login.py`, and terminate only this SSH forwarding process. The browser itself must remain running with its existing private profile. Then rerun the two-writer acceptance harness and test native renewal past the imported expiry and after a relay/browser restart. Seven-day reliability remains pending until observed over that period.

## Scope

The temporary display is for Admin login only. Writers keep the native OneClick Paraphraser workflow and never receive this display or upstream credentials.
