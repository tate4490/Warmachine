Warmachine JSON Decryptor
=========================

This tool decrypts data_general.json files from the Warmachine desktop app.

REQUIREMENTS
------------
Python 3.8 or later — download from https://www.python.org
  (Check "Add Python to PATH" during installation)

HOW TO USE
----------
1. Double-click Run_Decryptor.bat
2. Select your encrypted JSON file (e.g. data_general.json)
   Usually found in: C:\Users\[you]\AppData\Local\[app folder]\
3. Enter the password when prompted (e.g. dlse0seb)
4. The decrypted file will be saved in the same folder
   with "decrypted_" added to the front of the filename.

The first run will automatically install the required pycryptodome library.
