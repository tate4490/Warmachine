"""
Warmachine JSON Decryptor
Decrypts data files from the Warmachine desktop app.
Algorithm: AES-256-CFB, PBKDF2/SHA1, 50000 iterations, 32-byte salt prefix.
"""
import sys, os, re, shutil, hashlib, json, base64, configparser
import tkinter as tk
from tkinter import filedialog, scrolledtext

try:
    from Crypto.Cipher import AES
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pycryptodome'])
    from Crypto.Cipher import AES

# --- Config -----------------------------------------------------------

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH  = os.path.join(SCRIPT_DIR, 'config.ini')
CONFIG_SECTION = 'WM_Decryptor'

# Hard-coded fallback (base64 encoded)
DEFAULT_PASSWORD_B64 = 'ZGxzZTBzZWI='   # dlse0seb

CONFIG_TEMPLATE = """\
; Warmachine JSON Decryptor — configuration file
;
; PASSWORDS
; ---------
; All passwords are stored as Base64 to avoid plain-text shoulder-surfing.
; This is NOT strong encryption — it just keeps passwords out of plain sight.
; To encode your own password, use: https://www.base64encode.org
; or run: python -c "import base64; print(base64.b64encode(b'YourPassword').decode())"
;
; default_password  is tried first and should normally not need changing.
; password2 onward  are optional extras tried in order if the default fails.
; To add more, follow the same pattern: password4 = <base64>, password5 = <base64>, etc.
; To disable an optional password, delete it or add a semicolon at the start of the line.

[{section}]
default_password = {default_pw}

; --- Optional additional passwords (examples — replace or remove as needed) ---
; password2 = UEAkJHcwcmQ=    ; P@$$w0rd
; password3 = R29k            ; God

; FILES
; -----
; Last folder used in the file picker. Updated automatically after each run.
; You can also set this manually to pre-load a specific folder.
files_path =
"""


def load_config():
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_PATH):
        config.read(CONFIG_PATH)
    if not config.has_section(CONFIG_SECTION):
        config.add_section(CONFIG_SECTION)
    return config


def save_config(config):
    with open(CONFIG_PATH, 'w') as f:
        config.write(f)


def ensure_config():
    """Write the config file with comments if it doesn't exist yet."""
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'w') as f:
            f.write(CONFIG_TEMPLATE.format(
                section=CONFIG_SECTION,
                default_pw=DEFAULT_PASSWORD_B64
            ))


def get_passwords(config):
    """Return list of passwords to try, default first, then optional extras in order."""
    passwords = []

    # Default password
    default_b64 = config.get(CONFIG_SECTION, 'default_password', fallback=DEFAULT_PASSWORD_B64)
    try:
        passwords.append(base64.b64decode(default_b64.strip()).decode('utf-8'))
    except Exception:
        pass

    # Hard-coded fallback in case config is broken
    fallback = base64.b64decode(DEFAULT_PASSWORD_B64).decode('utf-8')
    if fallback not in passwords:
        passwords.append(fallback)

    # Optional additional passwords (password2, password3, ...)
    n = 2
    while True:
        key = f'password{n}'
        if not config.has_option(CONFIG_SECTION, key):
            break
        b64 = config.get(CONFIG_SECTION, key).strip()
        try:
            pw = base64.b64decode(b64).decode('utf-8')
            if pw not in passwords:
                passwords.append(pw)
        except Exception:
            pass
        n += 1

    return passwords


def get_initial_dir(config):
    path = config.get(CONFIG_SECTION, 'files_path', fallback='').strip()
    if path and os.path.isdir(path):
        return path
    return os.path.expanduser('~')


def save_files_path(config, folder):
    config.set(CONFIG_SECTION, 'files_path', folder)
    save_config(config)


# --- Decryption -------------------------------------------------------

def try_decrypt(data, password):
    """Attempt decryption with a single password. Returns plaintext bytes or raises."""
    salt       = data[:32]
    ciphertext = data[32:]
    dk         = hashlib.pbkdf2_hmac('sha1', password.encode('utf-8'), salt, 50000, dklen=48)
    key, iv    = dk[:32], dk[32:48]
    cipher     = AES.new(key, AES.MODE_CFB, iv=iv, segment_size=128)
    plaintext  = cipher.decrypt(ciphertext)
    # Strip PKCS7 padding if present
    pad_byte = plaintext[-1]
    if 1 <= pad_byte <= 16 and plaintext[-pad_byte:] == bytes([pad_byte] * pad_byte):
        plaintext = plaintext[:-pad_byte]
    json.loads(plaintext.decode('utf-8'))  # validate — raises if wrong password
    return plaintext


def decrypt_data(data, passwords):
    """Try each password in turn. Returns (plaintext, password_used) or raises."""
    last_error = None
    for pw in passwords:
        try:
            plaintext = try_decrypt(data, pw)
            return plaintext, pw
        except Exception as e:
            last_error = e
    raise last_error


# --- UI helpers -------------------------------------------------------

def unique_output_path(folder, filename):
    """Return a conflict-free path using Windows-style (n) numbering."""
    base, ext = os.path.splitext(filename)
    base      = re.sub(r'\s+\(\d+\)$', '', base)
    candidate = os.path.join(folder, base + ext)
    if not os.path.exists(candidate):
        return candidate
    n = 1
    while True:
        candidate = os.path.join(folder, f"{base} ({n}){ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def ask_password(root):
    pw_dialog = tk.Toplevel(root)
    pw_dialog.title("Password")
    pw_dialog.resizable(False, False)
    pw_dialog.grab_set()

    tk.Label(pw_dialog, text="No configured password worked.\nEnter password manually:", padx=20, pady=10).pack()
    pw_var  = tk.StringVar()
    pw_entry = tk.Entry(pw_dialog, textvariable=pw_var, show="*", width=30)
    pw_entry.pack(padx=20)
    pw_entry.focus()

    result = {'password': None}

    def on_ok(event=None):
        result['password'] = pw_var.get()
        pw_dialog.destroy()

    def on_cancel():
        pw_dialog.destroy()

    btn_frame = tk.Frame(pw_dialog)
    btn_frame.pack(pady=10)
    tk.Button(btn_frame, text="OK",     width=10, command=on_ok).pack(side=tk.LEFT, padx=5)
    tk.Button(btn_frame, text="Cancel", width=10, command=on_cancel).pack(side=tk.LEFT, padx=5)
    pw_entry.bind('<Return>', on_ok)

    pw_dialog.update_idletasks()
    w, h = pw_dialog.winfo_width(), pw_dialog.winfo_height()
    x    = (pw_dialog.winfo_screenwidth()  // 2) - (w // 2)
    y    = (pw_dialog.winfo_screenheight() // 2) - (h // 2)
    pw_dialog.geometry(f'+{x}+{y}')

    root.wait_window(pw_dialog)
    return result['password']


# --- Main processing --------------------------------------------------

def run_decryption(root, input_paths, passwords, config):
    win = tk.Toplevel(root)
    win.title("Decryption Status")
    win.geometry("680x440")
    win.resizable(True, True)

    tk.Label(win, text="Processing files...", anchor='w', padx=10, pady=5).pack(fill=tk.X)

    log = scrolledtext.ScrolledText(win, state='disabled', wrap=tk.WORD, font=("Courier", 9))
    log.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

    log.tag_config('ok',      foreground='green')
    log.tag_config('fail',    foreground='red')
    log.tag_config('info',    foreground='black')
    log.tag_config('heading', foreground='black', font=("Courier", 9, "bold"))
    log.tag_config('dim',     foreground='grey')

    close_btn = tk.Button(win, text="Close", state='disabled', command=win.destroy)
    close_btn.pack(pady=8)

    def append(text, tag='info'):
        log.config(state='normal')
        log.insert(tk.END, text, tag)
        log.see(tk.END)
        log.config(state='disabled')
        win.update()

    def process():
        first_folder  = os.path.dirname(input_paths[0])
        output_folder = os.path.join(first_folder, "Decrypted")

        append(f"Output folder: {output_folder}\n", 'dim')

        try:
            os.makedirs(output_folder, exist_ok=True)
        except Exception as e:
            append(f"\nFailed to create output folder: {e}\n", 'fail')
            append("Aborting — no files processed.\n", 'fail')
            close_btn.config(state='normal')
            return

        append(f"Files selected: {len(input_paths)}\n\n", 'heading')

        active_passwords = list(passwords)  # may grow if user enters one manually
        succeeded = 0
        failed    = 0

        for input_path in input_paths:
            filename = os.path.basename(input_path)
            append(f"  {filename}\n", 'heading')

            # Step 1: read file
            try:
                with open(input_path, 'rb') as f:
                    data = f.read()
            except Exception as e:
                append(f"    FAILED — Inaccessible: {e}\n\n", 'fail')
                failed += 1
                continue

            # Step 2: check if already plaintext JSON
            try:
                json.loads(data.decode('utf-8'))
                out_path = unique_output_path(output_folder, filename)
                shutil.copy2(input_path, out_path)
                append(f"    OK — Unencrypted\n", 'ok')
                append(f"    Copied to: {out_path}\n\n", 'dim')
                succeeded += 1
                continue
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass

            # Step 3: try decryption with all known passwords
            plaintext = None
            while plaintext is None:
                try:
                    plaintext, _ = decrypt_data(data, active_passwords)
                except Exception:
                    # All passwords failed — ask user for one
                    manual_pw = ask_password(root)
                    if not manual_pw:
                        # User cancelled
                        append(f"    FAILED — Wrong password and no manual password provided\n\n", 'fail')
                        failed += 1
                        break
                    active_passwords.append(manual_pw)

            if plaintext is None:
                continue

            try:
                out_path = unique_output_path(output_folder, filename)
                with open(out_path, 'wb') as f:
                    f.write(plaintext)
                append(f"    OK — Decrypted\n", 'ok')
                append(f"    Saved to: {out_path}\n\n", 'dim')
                succeeded += 1
            except PermissionError:
                append(f"    FAILED — Permission denied writing to output folder\n\n", 'fail')
                failed += 1
            except Exception as e:
                append(f"    FAILED — {e}\n\n", 'fail')
                failed += 1

        # Auto-save last used folder
        save_files_path(config, first_folder)

        append(f"{'=' * 50}\n", 'heading')
        summary = f"Done.  Succeeded: {succeeded}  |  Failed: {failed}\n"
        tag     = 'ok' if failed == 0 else ('fail' if succeeded == 0 else 'heading')
        append(summary, tag)
        close_btn.config(state='normal')

    win.after(100, process)
    root.wait_window(win)


def main():
    ensure_config()
    config    = load_config()
    passwords = get_passwords(config)
    init_dir  = get_initial_dir(config)

    root = tk.Tk()
    root.withdraw()

    input_paths = filedialog.askopenfilenames(
        title="Select Warmachine JSON file(s)",
        initialdir=init_dir,
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
    )
    if not input_paths:
        return

    run_decryption(root, input_paths, passwords, config)


if __name__ == '__main__':
    main()
