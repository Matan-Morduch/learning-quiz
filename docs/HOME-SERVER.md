# Home server: the quiz app on your desktop PC, 24/7

> **Current layout (Nov 2, 2026):** the quiz lives at **`https://homebox.tail3fc87e.ts.net/quiz/`** and LifeOS took over the root (`/`). `tailscale serve` strips the `/quiz` prefix, so the app still sees `/…`; all its URLs are relative, and `/quiz` without the slash redirects itself to `/quiz/`. LifeOS's own setup is in `LifeOS/README.md` ("Runs on homebox").

The goal: the quiz app runs on the desktop PC all the time, and you use it from your iPhone (and the Mac) even when the Mac is off. Nothing goes to the cloud except what already does: Obsidian Sync for the vault, and Claude through your subscription.

```
iPhone / Mac ──(Tailscale, private HTTPS)──▶ homebox: tailscale serve :443 ─┬─ /quiz/ ─▶ node server.js 127.0.0.1:4747 (this app)
                                                                            └─ /      ─▶ LifeOS 127.0.0.1:4700 (~/lifeos)
                                                       │  claude CLI (your subscription) · whisper.cpp on the GTX 1080
                                                       │  Kokoro voice · Rocky lab VM (KVM, optional)
Obsidian Sync ◀────────────────────────────────────────┴─ ~/vault (Obsidian Headless)
Mac: git push home main ──(ssh)──▶ ~/learning-quiz.git ──hook──▶ ~/learning-quiz (restart)
```

## What Claude already prepared

**The short version of what you do:** buy the cables (section 0) → make the USB stick (1) → BIOS (2) → install Ubuntu (3) → copy your SSH key and tell Claude "the server is ready at you@<ip>" (4) → do the logins when asked (5) → move your data (6) → add it to your iPhone home screen (7). Sections 0–3 and 5 need you; Claude can do 4 and 6.

Already done in the app (Oct 31, 2026), so it's ready to move:

- **Runs anywhere, not just inside LifeOS on the Mac.** Settings come from environment variables (`QUIZ_LEARNING_DIR`, `QUIZ_HOST`, `QUIZ_CLAUDE_BIN`, `QUIZ_VAULT`, …; see README "Running on Linux"). With none set, the Mac works exactly as before. New `GET /api/health`. File lookups work on Linux's case-sensitive disk.
- **Claude** is still the Claude Code CLI on your subscription; on the server it's found in `~/.local/bin`. No API.
- **Voice on Linux:** Kokoro runs on the GTX 1080 (ONNX Runtime + CUDA, the last versions that still support Pascal are pinned), or on the CPU if the GPU can't be used. Same voices as the Mac; the CPU path was tested here (~6 s for a 600-character board). Settings shows where the voice runs.
- **Dictation on Linux:** whisper.cpp built for the GTX 1080 by the install script (CPU build as a fallback).
- **iPhone:** Add to Home Screen opens it like an app (icon, full screen, notch-safe). Phone layout for every tab: bottom tab bar (Home, Teach, Practice, To Learn, More), the lesson ask box sits above the keyboard, big rating buttons, Settings as a full-screen sheet.
- **Install kit** in `deploy/`: `install.sh` (everything, re-runnable), `check.sh` (health of every part, never spends a Claude request), nightly backups to the HDD, push-to-update from the Mac (`git push home main`, no GitHub), `mac/migrate-data.sh` to move your progress once.

**Not tested yet (first real run will tell):** the scripts have never run on real Ubuntu; the GPU voice and GPU whisper on the actual GTX 1080; Obsidian Headless running as a background service (it's a beta); the iPhone keyboard behaviour in lessons (tested in an iPhone simulator only). If a step fails, the script says which one; tell Claude and paste the output.

---

## 0. Shopping and prep list

- [ ] **USB stick, 8 GB or more.** It gets erased.
- [ ] **A monitor cable for the GTX 1080.** The card has DisplayPort and HDMI (and one DVI). Plug the screen into the **graphics card**, not the motherboard. You only need the screen for the install.
- [ ] **A USB keyboard.** A mouse is optional; the installer is keyboard-only.
- [ ] **An Ethernet cable** from the PC to your router. Wi-Fi is possible but Ethernet is much more reliable for a server.
- [ ] **Back up anything on the PC you want to keep.** Installing Ubuntu **erases the disk you install to** (the Samsung NVMe). If there's Windows or files on the NVMe, they'll be gone. The HDD isn't touched unless you choose it.
- [ ] Your passwords at hand: Tailscale account, claude.ai, Obsidian account (+ 2FA app) and **your vault's end-to-end encryption password** if you set one.
- [ ] Optional: a plug-in power meter to see what the box really draws.

## 1. Make the USB installer (on the Mac)

1. [ ] Download **Ubuntu Server 24.04 LTS** (the newest 24.04.x point release, "amd64" ISO, ~3 GB) from <https://ubuntu.com/download/server>.
2. [ ] Write it to the stick. **Option A (easiest): balenaEtcher** (<https://etcher.balena.io>): *Flash from file* → the ISO → *Select target* → the USB stick (check its size!) → *Flash*.
3. **Option B: Terminal.** Be careful: picking the wrong disk erases it.
   ```sh
   diskutil list                      # before plugging the stick in
   # plug the stick in, then:
   diskutil list                      # the NEW entry, "(external, physical)", e.g. /dev/disk4. Check the size matches.
   diskutil unmountDisk /dev/disk4    # use YOUR number
   sudo dd if=~/Downloads/ubuntu-24.04.*-live-server-amd64.iso of=/dev/rdisk4 bs=4m status=progress
   diskutil eject /dev/disk4
   ```
   `rdisk4` (with the r) is the same disk, just faster. If macOS then says "the disk you inserted was not readable", click **Ignore**: that's normal.

## 2. BIOS settings (on the PC)

Plug in the screen (into the GTX 1080), keyboard, Ethernet and the USB stick. Power on and press the BIOS key (usually **Del** or **F2**). Names differ by motherboard; look for:

- [ ] **Restore on AC power loss → Power On** (also called *AC Back*, *After Power Failure*, *State after G3*). This makes the server come back by itself after a power cut.
- [ ] **Intel Virtualization Technology (VT-x) → Enabled** and **VT-d → Enabled** (needed for the lab VM).
- [ ] **Secure Boot → Disabled.** It's the simplest way to make the NVIDIA driver load. (With Secure Boot on, you'd have to enroll a key on a blue "MOK" screen at the next boot, which needs a monitor.)
- Leave the other power settings at their defaults: the install script turns sleep off, and the CPU still idles efficiently.
- [ ] **Boot from the USB stick**: save and exit, then press the boot-menu key (often **F12**, **F11** or **F8**) and pick the USB stick (the "UEFI:" entry if there are two).

## 3. Install Ubuntu Server

The installer is text-only: arrow keys, Space to tick, Enter to confirm.

1. [ ] Language: English. Keyboard: yours. Install type: **Ubuntu Server** (not "minimized").
2. [ ] Network: the Ethernet port should get an address automatically (note it, e.g. `192.168.1.50`). Proxy: none. Mirror: default.
3. [ ] **Storage — read carefully.** Choose **Use an entire disk** and pick the **Samsung 970 EVO Plus** (about **931 GB**, shown as an NVMe / `nvme0n1`). **Not** the HDD (1–2 TB, `sda`).
   - **Untick "Set up this disk as an LVM group"** (otherwise Ubuntu uses only ~100 GB of the disk by default).
   - On the summary screen check that only the NVMe is being formatted, then **Done → Continue**. ⚠️ **This erases the NVMe.**
4. [ ] Profile: your name, **server name `homebox`** (or anything you like; the guide says homebox), **your username** (same as on the Mac is handy), a password you'll remember (you need it for `sudo`).
5. [ ] Ubuntu Pro: **Skip for now**.
6. [ ] SSH: **tick "Install OpenSSH server"**. "Import SSH key": skip (you'll copy your Mac's key in step 4). Leave "Allow password authentication over SSH" on for now.
7. [ ] "Third-party drivers": **leave unticked** (the install script picks the right NVIDIA driver for the GTX 1080).
8. [ ] Featured snaps: **tick nothing**.
9. [ ] Wait, then **Reboot Now**; remove the USB stick when told. At the `homebox login:` prompt, log in once to check your password works, and run `ip -4 addr` if you didn't note the IP.

From now on the screen and keyboard can go: everything else is done over SSH.

## 4. First SSH from the Mac, then the install

On the Mac:

```sh
ssh-copy-id you@192.168.1.50     # your username + the server's IP; asks for your password once
ssh you@192.168.1.50             # should log in without a password now
```

(After the install, `ssh you@homebox.local` works at home and `ssh you@homebox` works from anywhere on Tailscale.)

Then **either** path:

**Path A — let Claude do it.** Tell Claude: *"the server is ready at you@192.168.1.50"*. It will push the code and run the install, stopping when it needs you to log in to something (step 5).

**Path B — do it yourself.** On the Mac, in the quiz folder:

```sh
cd ~/Desktop/matan/Learning/_quiz
deploy/mac/push.sh you@192.168.1.50      # creates ~/learning-quiz.git on the server and pushes main
```

Then on the server (`ssh you@192.168.1.50`):

```sh
~/learning-quiz/deploy/install.sh --with-lab       # leave out --with-lab if you don't want the Rocky VM
sudo reboot                                         # loads the NVIDIA driver (the script tells you)
~/learning-quiz/deploy/install.sh --with-lab       # once more after the reboot: quick, finishes anything left
~/learning-quiz/deploy/check.sh
```

The script is safe to run again any time; each step skips what's already done. It takes 20–40 minutes the first time (the CUDA build of whisper.cpp is the slow part). Useful options: `--no-gpu`, `--only <steps>`, `--skip <steps>`, `--vault-name <name>`, `--backup-disk /dev/sda1`; see `install.sh --help`.

## 5. Logins only you can do

The install script stops and asks for these (or lists them at the end under **Left for you**). None of them is automated with stored passwords.

- [ ] **Tailscale on the server**: `sudo tailscale up` prints a URL; open it on the Mac or phone and approve the machine.
- [ ] **Tailscale admin console** (<https://login.tailscale.com/admin/dns>): turn **MagicDNS ON** and, under *HTTPS Certificates*, click **Enable HTTPS**. (If `tailscale serve` shows a link to enable Serve/HTTPS, open it and approve.) Your address will look like `https://homebox.<your-tailnet>.ts.net`; the tailnet name is shown on that page.
- [ ] Optional, recommended: in the admin console's *Machines* list, open homebox → **Disable key expiry**, so the server never drops off the tailnet.
- [ ] **Claude**: run `claude` on the server (or `claude auth login`). Pick your claude.ai account (subscription). It shows a URL: press `c` to copy it, open it on the Mac/phone, sign in, and if the browser shows a code, paste it back at *Paste code here if prompted*. Then `systemctl --user restart learning-quiz` (the app checks for Claude once at start). No API key is used.
- [ ] **Obsidian Sync** (`ob`, the official Obsidian Headless CLI): `ob login` (email, password, 2FA code) → `ob sync-list-remote` → pick your vault → `ob sync-setup --vault "<name>" --path ~/vault --device-name homebox` → it asks for the vault's **end-to-end encryption password** → the script excludes `Learning/_quiz` from sync (the code lives in `~/learning-quiz`) and does a first full sync.
- [ ] **Vault name for links**: the app needs your vault's name as Obsidian shows it, for `obsidian://` links (the Mac folder is `matan`). Open Obsidian on the iPhone, check the vault's name, and if it isn't `matan`: `~/learning-quiz/deploy/install.sh --only obsidian --vault-name "<that name>"` then `systemctl --user restart learning-quiz`.
- [ ] **iPhone**: install **Tailscale** from the App Store and sign in with the same account. Same on the Mac if you want to reach the server when you're away from home.

## 6. Move your progress from the Mac (once)

1. [ ] On the Mac, **quit the quiz app and LifeOS** (anything on ports 4747 / 4700).
2. [ ] Run, in the quiz folder:
   ```sh
   deploy/mac/migrate-data.sh --with-models       # --with-models also copies the Whisper models (saves a download)
   ```
   It stops the app on the server, copies `data/` (your history, lessons, gaps, To Learn, settings, voice cache), copies `data/voice.json` (your ElevenLabs key) privately with mode 600 without ever printing it, starts the app again and checks it. Try `--dry-run` first if you like.
3. [ ] **Stop using the Mac copy from now on.** If you answer in an old Mac copy, your progress splits between two places. Use the server's address on the Mac too. (LifeOS itself now runs on homebox too; its quiz tile opens `/quiz/`.)

## 7. iPhone

1. [ ] Tailscale on (the VPN icon shows in the status bar).
2. [ ] In Safari open **`https://homebox.<your-tailnet>.ts.net/quiz/`** (`deploy/check.sh` prints the exact address). The root of that address is LifeOS.
3. [ ] **Share → Add to Home Screen.** It opens like an app. The mic (dictation) works because it's real HTTPS.

## 8. Daily use

**Updates (code changes):** commit on the Mac, then

```sh
git push home main          # or deploy/mac/push.sh (also refreshes the server's hook)
```

The server checks out `main`, refreshes its service files if they changed, restarts the app and prints `✓ up` in your push output. Your data (`data/`) is never touched by a push. Only committed changes go. The first time you push over Tailscale instead of the LAN IP, run `deploy/mac/push.sh you@homebox` once to point the `home` remote at the MagicDNS name.

**Health:** `ssh you@homebox learning-quiz/deploy/check.sh` checks every part: services, `/api/health`, Claude installed + logged in (credentials file; it never spends a Claude request), vault sync, whisper + model + GPU, voice, Tailscale HTTPS, backups, lab VM.

**Power cuts:** with *Restore on AC power loss* the PC turns itself back on; Ubuntu starts the app, the vault sync, Tailscale (and the lab VM) with no login needed. Allow ~1–2 minutes.

**Updates to Ubuntu:** security updates install by themselves; if one needs a reboot, it reboots at **04:30**. The NVIDIA driver is left out of automatic updates (an update under a running system breaks CUDA until a reboot). Every month or two: `sudo apt update && sudo apt upgrade && sudo reboot`. The driver stays on the **580** branch: it's the last one that supports the GTX 1080, and it keeps getting security fixes. Claude Code updates itself.

**Backups:** every night at 03:30 `data/` is archived to `BACKUP_DIR` (the HDD at `/mnt/hdd/backups/learning-quiz` if set up, else `~/backups/learning-quiz`), 30 days kept. Run one now: `systemctl --user start learning-quiz-backup`. Restore: `systemctl --user stop learning-quiz && tar -xzf <archive> -C ~/learning-quiz && systemctl --user start learning-quiz`. The vault itself has Obsidian Sync's version history; add `BACKUP_VAULT=1` to `~/.config/learning-quiz/env` for a second copy.

**Backup disk (optional, the HDD):** ⚠️ formatting **erases the HDD**. Only if there's nothing on it you need:

```sh
lsblk -o NAME,SIZE,ROTA,MODEL,MOUNTPOINT     # the HDD is ROTA=1, 1–2 TB, e.g. sda. NOT nvme0n1.
sudo parted /dev/sda --script mklabel gpt mkpart backup ext4 0% 100%
sudo mkfs.ext4 -L backup /dev/sda1
~/learning-quiz/deploy/install.sh --only backup --backup-disk /dev/sda1
```

**Electricity:** expect roughly **45–70 W at the wall at idle** (i7 idling, GTX 1080 in its low-power state with the driver loaded, NVMe, a spinning HDD), so about 1.1–1.7 kWh a day. Measure with a plug meter to know for sure. Optional savings: `sudo apt install powertop && sudo powertop --auto-tune` (test that USB/Ethernet still behave), and spinning the HDD down when idle (`sudo hdparm -S 241 /dev/sda` = 30 min).

### Control the PC from anywhere

Everything goes through **Tailscale**: an encrypted connection (WireGuard) between *your* devices only. Nothing is opened on the router, so the PC isn't visible on the internet; the firewall (`ufw`) lets in only Tailscale, plus SSH from your home network as a fallback. Turn on two-factor login on the account you use for Tailscale (Google/Apple/GitHub) — that account is the key to everything.

| What | How | Feels like |
|---|---|---|
| **Desktop window** | Mac: install **Windows App** (Microsoft, free, App Store) → *Add PC* → `homebox` → log in with your Linux username/password. iPhone: same app. | A virtual machine window: Xfce desktop, mouse, apps |
| **Control panel** | Browser: `https://homebox:9090`, log in with your Linux user. Accept the certificate warning once. | CPU/RAM/disk graphs, services, logs, updates, terminal, restart, the lab VM's screen |
| **Terminal** | `ssh matan@homebox` | Command line (how Claude manages it) |

Works the same at home and abroad, as long as Tailscale is on in the device you're using. SSH accepts keys only (no passwords); to add a new computer's key, use the control panel's terminal or an existing SSH session.

### Troubleshooting

| Symptom | Check / fix |
|---|---|
| iPhone can't open the page | Tailscale on in the iPhone? `deploy/check.sh` → Tailscale section. `tailscale serve status` should show `/quiz/ proxy http://127.0.0.1:4747` (and `/ proxy http://127.0.0.1:4700` for LifeOS). Re-add: `tailscale serve --bg --https=443 --set-path /quiz/ http://127.0.0.1:4747` (or `deploy/install.sh --only serve`). |
| "Certificate" / HTTPS error | MagicDNS + HTTPS Certificates enabled in the admin console? The first visit can take ~1 min while the certificate is issued. |
| Page loads but no questions | Vault not synced: `systemctl --user status obsidian-sync`, `ob sync-status --path ~/vault`, `ls ~/vault/Learning`. |
| AI grading / teacher doesn't work | `claude --version`; logged in? (`ls ~/.claude/.credentials.json`, or run `claude` and `/login`). Then `systemctl --user restart learning-quiz`. |
| Dictation fails | `deploy/check.sh` → Dictation. After a driver update: reboot. Rebuild: `deploy/install.sh --only whisper` (or `--no-gpu --only whisper` for a CPU build). |
| `nvidia-smi` fails | Reboot (driver updated, or first install). Secure Boot on? Turn it off in the BIOS. |
| Voice falls back to the browser | `bash ~/learning-quiz/tools/tts-server/install.sh`; log: `~/.local/share/quiz-tts/server.log`. |
| `git push home` hangs / refused | `ssh you@homebox` works? If the push output ends with ✗, read the log lines it prints; `journalctl --user -u learning-quiz -n 50`. |
| Lab terminal can't connect | `ssh rocky` on the server; `sudo virsh list --all`; `sudo virsh start rocky`; console: `sudo virsh console rocky` (exit with Ctrl+]). |
| App not running after a reboot | `loginctl show-user $USER -p Linger` must say `yes`; `systemctl --user status learning-quiz`. |
| Logs | `journalctl --user -u learning-quiz -f` · `-u obsidian-sync` · `-u learning-quiz-backup` |

### Where things are on the server

| What | Where |
|---|---|
| Code (git checkout of `main`) | `~/learning-quiz` |
| Push target (bare repo + hook) | `~/learning-quiz.git` |
| Your progress | `~/learning-quiz/data` |
| Vault (Obsidian Sync) | `~/vault` (app reads `~/vault/Learning`) |
| Settings for the services | `~/.config/learning-quiz/env` (overrides the unit files) |
| Services | `~/.config/systemd/user/{learning-quiz,obsidian-sync,learning-quiz-backup}.*` |
| claude, ob, whisper-cli | `~/.local/bin/` |
| Whisper models | `~/.cache/quiz-whisper/` |
| Voice | `~/.local/share/quiz-tts/` |
| Lab VM disk | `/var/lib/libvirt/images/rocky.qcow2` (192.168.122.10, `ssh rocky`) |

---

## Sources

- Obsidian Headless (install, `ob login`, Node 22+): <https://obsidian.md/help/headless> · Headless Sync commands (`sync-list-remote`, `sync-setup`, `sync --continuous`, `sync-config --excluded-folders`, `sync-status`): <https://obsidian.md/help/sync/headless> · package: <https://github.com/obsidianmd/obsidian-headless>
- `tailscale serve` (current syntax, `--bg` persists across reboots): <https://tailscale.com/kb/1242/tailscale-serve> · HTTPS certificates: <https://tailscale.com/kb/1153/enabling-https> · MagicDNS: <https://tailscale.com/kb/1081/magicdns>
- Claude Code install (native installer → `~/.local/bin/claude`, auto-updates; Ubuntu 20.04+): <https://code.claude.com/docs/en/setup> · login, `~/.claude/.credentials.json` on Linux, `claude setup-token`: <https://code.claude.com/docs/en/authentication>
- NVIDIA 580 is the last driver branch for Maxwell/Pascal/Volta: <https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW> · CUDA 13.0 removed offline compilation for Maxwell/Pascal/Volta (12.x still builds sm_61): <https://docs.nvidia.com/cuda/cuda-features-archive/index.html> · CUDA 12.9 Linux install guide (Ubuntu 24.04, GCC 6–14, network repo): <https://docs.nvidia.com/cuda/archive/12.9.1/cuda-installation-guide-linux/index.html> · NVIDIA open kernel modules need Turing or newer (so Pascal uses the proprietary module): <https://github.com/NVIDIA/open-gpu-kernel-modules> · Ubuntu 580-server packages for 24.04: <https://ubuntuupdates.org/package/core/noble/restricted/updates/nvidia-headless-580-server>, <https://ubuntuhandbook.org/index.php/2025/09/ubuntu-added-nvidia-580-driver/>
- whisper.cpp build (`-DGGML_CUDA=1`, `build/bin/whisper-cli`, models): <https://github.com/ggml-org/whisper.cpp>
- Node.js via NodeSource: <https://github.com/nodesource/distributions>
- Rocky Linux 9 GenericCloud image: <https://dl.rockylinux.org/pub/rocky/9/images/x86_64/>
- Ubuntu Server install guide: <https://ubuntu.com/server/docs/install/step-by-step> · unattended upgrades: <https://ubuntu.com/server/docs/package-management#automatic-updates>
