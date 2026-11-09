WoodTek Workflow Lab - what this folder is
===============================================================================

This is a SEPARATE, side-by-side WoodTek installation for testing production
workflows. It is not the factory system. The factory system keeps running from
its own folder on its own port with its own database.

THIS FOLDER
  Folder ....... C:\WoodTek-Workflow-Lab      (the factory folder is untouched)
  Web address .. http://localhost:3001        (the factory answers on 3000)
  Database ..... woodtek_workflow_lab        (the factory database is untouched)
  Log file ..... logs\woodtek-workflow-lab.log
  Scheduled tasks
      "\WoodTek Workflow Lab"                 starts the lab at boot
      "WoodTek Workflow Lab Nightly Backup"   dumps the LAB database at 02:30
  Firewall rule  "WoodTek Workflow Lab Server" (only the lab port)
  Shortcuts .... "WoodTek Workflow Lab" on the Desktop and in the Start Menu

WHAT IT CONTAINS
  Core production and stock only: orders, routing, shop floor, operator station,
  WIP, reception, warehouse and BOM, stock, dispatch, Gantt, clients, quality,
  downtime and reports. Asset CMMS stays installed.

LOCKED MODULES (no way to switch them on here)
  Invoicing & Money, Purchasing & Suppliers, HR & Payroll, Design Department.
  They are locked by the installation itself (data\installed-edition.json), not
  just hidden: their screens, their API routes and their Settings switches all
  refuse, for every role including Manager.

DOUBLE-CLICK HELPERS IN THIS FOLDER
  start-workflow-lab.bat          start the lab in a window (in this folder)
  start-workflow-lab-silent.bat   used by the scheduled task; logs to logs\
  stop-workflow-lab.bat           stop ONLY the lab
  check-workflow-lab.bat          read-only health check of the lab
  update-workflow-lab.bat         refresh the lab application files and restart

WHAT THE LAB NEVER DOES
  It never stops, rewrites, re-points or backs up the factory installation. It
  never connects to the factory database. Its own backup task dumps only
  woodtek_workflow_lab.

HOW TO GET RID OF IT (manual, on purpose - nothing deletes data by itself)
  1. stop-workflow-lab.bat
  2. schtasks /Delete /TN "\WoodTek Workflow Lab" /F
     schtasks /Delete /TN "WoodTek Workflow Lab Nightly Backup" /F
  3. netsh advfirewall firewall delete rule name="WoodTek Workflow Lab Server"
  4. delete the Desktop and Start Menu shortcuts named "WoodTek Workflow Lab"
  5. optional: drop the test database with
     "C:\Program Files\PostgreSQL\16\bin\dropdb.exe" -U postgres woodtek_workflow_lab
  6. delete this folder
  The factory installation is not involved in any of these steps.
