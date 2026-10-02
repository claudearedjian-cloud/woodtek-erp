// ============================================================================
// WoodTek ERP — Native Windows .exe Setup Wizard (SetupWizard.cs)
// ----------------------------------------------------------------------------
// Compiled by Windows' built-in .NET Framework 4.0+ C# compiler (csc.exe)
// during build-installer.ps1 into WoodTek-ERP-Setup.exe.
//
// Features:
//  - Self-contained SFX: reads the appended payload.zip trailer ("WTSETUP1" +
//    8-byte Int64 zip length) at the end of WoodTek-ERP-Setup.exe.
//  - Module selection wizard: Core Production & Stock is always installed;
//    optional checkboxes for:
//      1. Invoicing, Job Costing & Money (invoicing)
//      2. Purchasing & Suppliers (purchasing)
//      3. Asset CMMS (cmms)
//      4. Workforce, Shifts & HR (workforce)
//  - Hard installation lock: selected modules are written to
//    <InstallDir>\data\installed-edition.json; unselected modules are locked
//    out in both UI and server APIs until Setup is re-run.
//  - Full turnkey execution: invokes install-engine.ps1 to set up Node.js,
//    PostgreSQL, database schema, .env, Windows Firewall, Scheduled Tasks,
//    and Desktop/Start Menu shortcuts.
//  - Also supports silent CLI mode:
//    WoodTek-ERP-Setup.exe /SILENT /DIR="C:\WoodTek-ERP" /ADDONS="invoicing,cmms"
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace WoodTekSetup
{
    public class SetupWizardForm : Form
    {
        private Panel headerPanel;
        private Label lblHeaderTitle;
        private Label lblHeaderSub;

        private Panel pageModules;
        private Panel pageConfig;
        private Panel pageProgress;
        private Panel pageFinish;

        private CheckBox chkCore;
        private CheckBox chkInvoicing;
        private CheckBox chkPurchasing;
        private CheckBox chkCmms;
        private CheckBox chkWorkforce;

        private TextBox txtInstallDir;
        private TextBox txtPort;
        private TextBox txtPgPass;
        private TextBox txtManagerName;
        private TextBox txtManagerPin;

        private ProgressBar progressBar;
        private Label lblCurrentStep;
        private TextBox txtLog;

        private Label lblFinishSummary;
        private CheckBox chkOpenBrowser;

        private Button btnBack;
        private Button btnNext;
        private Button btnCancel;

        private int currentPage = 0;
        private bool installRunning = false;
        private bool installSucceeded = false;

        public SetupWizardForm()
        {
            this.Text = "WoodTek ERP — Turnkey Setup Wizard";
            this.Size = new Size(720, 560);
            this.MinimumSize = new Size(720, 560);
            this.MaximumSize = new Size(720, 560);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.FromArgb(241, 245, 249);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            BuildHeader();
            BuildFooter();
            BuildPageModules();
            BuildPageConfig();
            BuildPageProgress();
            BuildPageFinish();

            DetectExistingInstallation(txtInstallDir.Text);
            ShowPage(0);
        }

        private void BuildHeader()
        {
            headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 76;
            headerPanel.BackColor = Color.FromArgb(2, 6, 23);

            lblHeaderTitle = new Label();
            lblHeaderTitle.Text = "WoodTek ERP — Setup & Module Selector";
            lblHeaderTitle.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblHeaderTitle.ForeColor = Color.FromArgb(251, 191, 36);
            lblHeaderTitle.Location = new Point(24, 14);
            lblHeaderTitle.AutoSize = true;

            lblHeaderSub = new Label();
            lblHeaderSub.Text = "Step 1 of 3 · Choose which ERP modules to install on this computer";
            lblHeaderSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblHeaderSub.ForeColor = Color.FromArgb(148, 163, 184);
            lblHeaderSub.Location = new Point(26, 44);
            lblHeaderSub.AutoSize = true;

            headerPanel.Controls.Add(lblHeaderTitle);
            headerPanel.Controls.Add(lblHeaderSub);
            this.Controls.Add(headerPanel);
        }

        private void BuildFooter()
        {
            Panel footer = new Panel();
            footer.Dock = DockStyle.Bottom;
            footer.Height = 60;
            footer.BackColor = Color.FromArgb(2, 6, 23);

            btnBack = new Button();
            btnBack.Text = "< Back";
            btnBack.Size = new Size(100, 34);
            btnBack.Location = new Point(360, 13);
            btnBack.FlatStyle = FlatStyle.Flat;
            btnBack.BackColor = Color.FromArgb(30, 41, 59);
            btnBack.ForeColor = Color.White;
            btnBack.Click += new EventHandler(OnBackClick);

            btnNext = new Button();
            btnNext.Text = "Next >";
            btnNext.Size = new Size(120, 34);
            btnNext.Location = new Point(470, 13);
            btnNext.FlatStyle = FlatStyle.Flat;
            btnNext.BackColor = Color.FromArgb(245, 158, 11);
            btnNext.ForeColor = Color.FromArgb(2, 6, 23);
            btnNext.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnNext.Click += new EventHandler(OnNextClick);

            btnCancel = new Button();
            btnCancel.Text = "Cancel";
            btnCancel.Size = new Size(90, 34);
            btnCancel.Location = new Point(600, 13);
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.BackColor = Color.FromArgb(30, 41, 59);
            btnCancel.ForeColor = Color.FromArgb(203, 213, 225);
            btnCancel.Click += new EventHandler(OnCancelClick);

            footer.Controls.Add(btnBack);
            footer.Controls.Add(btnNext);
            footer.Controls.Add(btnCancel);
            this.Controls.Add(footer);
        }

        private void BuildPageModules()
        {
            pageModules = CreateContentPanel();

            Label intro = new Label();
            intro.Text = "Core Production & Stock is always installed. Tick the optional module packs you want enabled on this PC. Unchecked modules will be hard-locked and hidden until you re-run this installer.";
            intro.Location = new Point(24, 12);
            intro.Size = new Size(655, 38);
            intro.ForeColor = Color.FromArgb(203, 213, 225);
            pageModules.Controls.Add(intro);

            chkCore = new CheckBox();
            chkCore.Text = "Core Production & Stock (Required Base) — Orders, Routing, Shop Floor, Operator Station, WIP, Reception, Warehouse & BOM, Stock, Dispatch, Gantt, Clients, Quality, Downtime, Reports";
            chkCore.Checked = true;
            chkCore.Enabled = false;
            chkCore.Font = new Font("Segoe UI", 9.2f, FontStyle.Bold);
            chkCore.ForeColor = Color.FromArgb(52, 211, 153);
            chkCore.Location = new Point(28, 56);
            chkCore.Size = new Size(650, 42);
            pageModules.Controls.Add(chkCore);

            chkInvoicing = CreateAddonCheckbox(
                "Invoicing, Job Costing & Money — Quotations, VAT Invoices (11%), Client Payments, A/R Aging, Job Costing & Profit, and all financial columns",
                106
            );
            chkPurchasing = CreateAddonCheckbox(
                "Purchasing & Suppliers — Suppliers, Purchase Orders, Goods Receipts (GRN) that add stock, and Supplier Bills & A/P Aging",
                160
            );
            chkCmms = CreateAddonCheckbox(
                "Asset CMMS (Maintenance & Generators) — Plant Asset Registry, Generator Power & Fuel Telemetry, Preventative Maintenance Logs & Alerts",
                214
            );
            chkWorkforce = CreateAddonCheckbox(
                "Workforce, Shifts & HR — Shift Definitions, Production Shift Calendar, Time & Attendance Clock-In/Out, and HR & Payroll",
                268
            );

            pageModules.Controls.Add(chkInvoicing);
            pageModules.Controls.Add(chkPurchasing);
            pageModules.Controls.Add(chkCmms);
            pageModules.Controls.Add(chkWorkforce);

            Button btnAll = new Button();
            btnAll.Text = "Select All (Full ERP)";
            btnAll.Size = new Size(160, 30);
            btnAll.Location = new Point(28, 330);
            btnAll.FlatStyle = FlatStyle.Flat;
            btnAll.BackColor = Color.FromArgb(30, 41, 59);
            btnAll.ForeColor = Color.FromArgb(251, 191, 36);
            btnAll.Click += delegate(object s, EventArgs e) {
                chkInvoicing.Checked = true;
                chkPurchasing.Checked = true;
                chkCmms.Checked = true;
                chkWorkforce.Checked = true;
            };

            Button btnCoreOnly = new Button();
            btnCoreOnly.Text = "Core Production Only";
            btnCoreOnly.Size = new Size(160, 30);
            btnCoreOnly.Location = new Point(200, 330);
            btnCoreOnly.FlatStyle = FlatStyle.Flat;
            btnCoreOnly.BackColor = Color.FromArgb(30, 41, 59);
            btnCoreOnly.ForeColor = Color.FromArgb(203, 213, 225);
            btnCoreOnly.Click += delegate(object s, EventArgs e) {
                chkInvoicing.Checked = false;
                chkPurchasing.Checked = false;
                chkCmms.Checked = false;
                chkWorkforce.Checked = false;
            };

            pageModules.Controls.Add(btnAll);
            pageModules.Controls.Add(btnCoreOnly);
            this.Controls.Add(pageModules);
        }

        private CheckBox CreateAddonCheckbox(string text, int top)
        {
            CheckBox cb = new CheckBox();
            cb.Text = text;
            cb.Checked = true;
            cb.Font = new Font("Segoe UI", 9.2f, FontStyle.Regular);
            cb.ForeColor = Color.White;
            cb.Location = new Point(28, top);
            cb.Size = new Size(650, 46);
            return cb;
        }

        private void BuildPageConfig()
        {
            pageConfig = CreateContentPanel();

            AddFieldLabel(pageConfig, "Installation Folder:", 20);
            txtInstallDir = new TextBox();
            txtInstallDir.Text = Directory.Exists(@"C:\woodtek-erp\woodtek-erp")
                ? @"C:\woodtek-erp\woodtek-erp"
                : @"C:\WoodTek-ERP";
            txtInstallDir.Location = new Point(24, 44);
            txtInstallDir.Size = new Size(540, 28);
            txtInstallDir.BackColor = Color.FromArgb(30, 41, 59);
            txtInstallDir.ForeColor = Color.White;
            pageConfig.Controls.Add(txtInstallDir);

            Button btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(574, 42);
            btnBrowse.Size = new Size(100, 28);
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.BackColor = Color.FromArgb(30, 41, 59);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.Click += delegate(object s, EventArgs e) {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = txtInstallDir.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtInstallDir.Text = fbd.SelectedPath;
                        DetectExistingInstallation(txtInstallDir.Text);
                    }
                }
            };
            pageConfig.Controls.Add(btnBrowse);

            AddFieldLabel(pageConfig, "Web Server Port (LAN & Localhost):", 92);
            txtPort = new TextBox();
            txtPort.Text = "3000";
            txtPort.Location = new Point(24, 116);
            txtPort.Size = new Size(140, 28);
            txtPort.BackColor = Color.FromArgb(30, 41, 59);
            txtPort.ForeColor = Color.White;
            pageConfig.Controls.Add(txtPort);

            AddFieldLabel(pageConfig, "Local PostgreSQL 'postgres' Password (used to auto-install or connect):", 160);
            txtPgPass = new TextBox();
            txtPgPass.Text = "postgres";
            txtPgPass.Location = new Point(24, 184);
            txtPgPass.Size = new Size(260, 28);
            txtPgPass.BackColor = Color.FromArgb(30, 41, 59);
            txtPgPass.ForeColor = Color.White;
            pageConfig.Controls.Add(txtPgPass);

            AddFieldLabel(pageConfig, "Initial Manager Name (created automatically if database has no users):", 232);
            txtManagerName = new TextBox();
            txtManagerName.Text = "Claude Aredjian";
            txtManagerName.Location = new Point(24, 256);
            txtManagerName.Size = new Size(280, 28);
            txtManagerName.BackColor = Color.FromArgb(30, 41, 59);
            txtManagerName.ForeColor = Color.White;
            pageConfig.Controls.Add(txtManagerName);

            AddFieldLabel(pageConfig, "Initial Manager PIN (4 digits):", 300);
            txtManagerPin = new TextBox();
            txtManagerPin.Text = "1234";
            txtManagerPin.Location = new Point(24, 324);
            txtManagerPin.Size = new Size(140, 28);
            txtManagerPin.BackColor = Color.FromArgb(30, 41, 59);
            txtManagerPin.ForeColor = Color.White;
            pageConfig.Controls.Add(txtManagerPin);

            this.Controls.Add(pageConfig);
        }

        private void AddFieldLabel(Panel parent, string text, int top)
        {
            Label lbl = new Label();
            lbl.Text = text;
            lbl.Location = new Point(24, top);
            lbl.AutoSize = true;
            lbl.Font = new Font("Segoe UI", 9.2f, FontStyle.Bold);
            lbl.ForeColor = Color.FromArgb(226, 232, 240);
            parent.Controls.Add(lbl);
        }

        private void BuildPageProgress()
        {
            pageProgress = CreateContentPanel();

            lblCurrentStep = new Label();
            lblCurrentStep.Text = "Preparing installation...";
            lblCurrentStep.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            lblCurrentStep.ForeColor = Color.FromArgb(251, 191, 36);
            lblCurrentStep.Location = new Point(24, 18);
            lblCurrentStep.Size = new Size(650, 24);
            pageProgress.Controls.Add(lblCurrentStep);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(24, 48);
            progressBar.Size = new Size(650, 22);
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Value = 5;
            pageProgress.Controls.Add(progressBar);

            txtLog = new TextBox();
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.Location = new Point(24, 82);
            txtLog.Size = new Size(650, 280);
            txtLog.BackColor = Color.FromArgb(2, 6, 23);
            txtLog.ForeColor = Color.FromArgb(203, 213, 225);
            txtLog.Font = new Font("Consolas", 9f, FontStyle.Regular);
            pageProgress.Controls.Add(txtLog);

            this.Controls.Add(pageProgress);
        }

        private void BuildPageFinish()
        {
            pageFinish = CreateContentPanel();

            lblFinishSummary = new Label();
            lblFinishSummary.Location = new Point(24, 24);
            lblFinishSummary.Size = new Size(650, 250);
            lblFinishSummary.Font = new Font("Segoe UI", 10f, FontStyle.Regular);
            lblFinishSummary.ForeColor = Color.White;
            pageFinish.Controls.Add(lblFinishSummary);

            chkOpenBrowser = new CheckBox();
            chkOpenBrowser.Text = "Open WoodTek ERP in my web browser now";
            chkOpenBrowser.Checked = true;
            chkOpenBrowser.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            chkOpenBrowser.ForeColor = Color.FromArgb(251, 191, 36);
            chkOpenBrowser.Location = new Point(24, 290);
            chkOpenBrowser.AutoSize = true;
            pageFinish.Controls.Add(chkOpenBrowser);

            this.Controls.Add(pageFinish);
        }

        private Panel CreateContentPanel()
        {
            Panel p = new Panel();
            p.Location = new Point(0, 76);
            p.Size = new Size(710, 384);
            p.BackColor = Color.FromArgb(15, 23, 42);
            p.Visible = false;
            return p;
        }

        private void DetectExistingInstallation(string dir)
        {
            try
            {
                string editionFile = Path.Combine(dir, @"data\installed-edition.json");
                if (File.Exists(editionFile))
                {
                    string json = File.ReadAllText(editionFile, Encoding.UTF8).ToLowerInvariant();
                    chkInvoicing.Checked = json.Contains("\"invoicing\"");
                    chkPurchasing.Checked = json.Contains("\"purchasing\"");
                    chkCmms.Checked = json.Contains("\"cmms\"");
                    chkWorkforce.Checked = json.Contains("\"workforce\"");
                }
            }
            catch
            {
            }
        }

        private string SelectedAddonsCsv()
        {
            List<string> list = new List<string>();
            if (chkInvoicing.Checked) list.Add("invoicing");
            if (chkPurchasing.Checked) list.Add("purchasing");
            if (chkCmms.Checked) list.Add("cmms");
            if (chkWorkforce.Checked) list.Add("workforce");
            return string.Join(",", list.ToArray());
        }

        private void ShowPage(int index)
        {
            currentPage = index;
            pageModules.Visible = (index == 0);
            pageConfig.Visible = (index == 1);
            pageProgress.Visible = (index == 2);
            pageFinish.Visible = (index == 3);

            if (index == 0)
            {
                lblHeaderSub.Text = "Step 1 of 3 · Choose which ERP modules to install on this computer";
                btnBack.Enabled = false;
                btnNext.Text = "Next >";
            }
            else if (index == 1)
            {
                lblHeaderSub.Text = "Step 2 of 3 · Installation folder, port, PostgreSQL & initial Manager PIN";
                btnBack.Enabled = true;
                btnNext.Text = "Install Now";
            }
            else if (index == 2)
            {
                lblHeaderSub.Text = "Step 3 of 3 · Installing WoodTek ERP and configuring services...";
                btnBack.Enabled = false;
                btnNext.Enabled = false;
                btnCancel.Enabled = false;
            }
            else if (index == 3)
            {
                lblHeaderSub.Text = "Setup Complete · WoodTek ERP is ready";
                btnBack.Visible = false;
                btnCancel.Visible = false;
                btnNext.Enabled = true;
                btnNext.Text = "Finish";
            }
        }

        private void OnBackClick(object sender, EventArgs e)
        {
            if (currentPage == 1 && !installRunning)
            {
                ShowPage(0);
            }
        }

        private void OnCancelClick(object sender, EventArgs e)
        {
            if (installRunning) return;
            this.Close();
        }

        private void OnNextClick(object sender, EventArgs e)
        {
            if (currentPage == 0)
            {
                ShowPage(1);
            }
            else if (currentPage == 1)
            {
                ShowPage(2);
                StartInstallationAsync();
            }
            else if (currentPage == 3)
            {
                if (installSucceeded && chkOpenBrowser.Checked)
                {
                    int port = 3000;
                    int.TryParse(txtPort.Text.Trim(), out port);
                    if (port <= 0) port = 3000;
                    try
                    {
                        Process.Start(string.Format("http://localhost:{0}/", port));
                    }
                    catch { }
                }
                this.Close();
            }
        }

        private void AppendLog(string line)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action<string>(AppendLog), new object[] { line });
                return;
            }
            if (string.IsNullOrEmpty(line)) return;
            if (line.StartsWith("[STEP]"))
            {
                string stepText = line.Substring(6).Trim();
                lblCurrentStep.Text = stepText;
                if (stepText.Contains("1/7")) progressBar.Value = 12;
                else if (stepText.Contains("2/7")) progressBar.Value = 28;
                else if (stepText.Contains("3/7")) progressBar.Value = 45;
                else if (stepText.Contains("4/7")) progressBar.Value = 62;
                else if (stepText.Contains("5/7")) progressBar.Value = 78;
                else if (stepText.Contains("6/7")) progressBar.Value = 90;
                else if (stepText.Contains("7/7")) progressBar.Value = 96;
            }
            txtLog.AppendText(line + Environment.NewLine);
        }

        private void StartInstallationAsync()
        {
            installRunning = true;
            string installDir = txtInstallDir.Text.Trim();
            string addons = SelectedAddonsCsv();
            int port = 3000;
            if (!int.TryParse(txtPort.Text.Trim(), out port) || port <= 0) port = 3000;
            string pgPass = txtPgPass.Text;
            string mgrName = txtManagerName.Text.Trim();
            string mgrPin = txtManagerPin.Text.Trim();

            Thread worker = new Thread(delegate() {
                try
                {
                    InstallerRunner.ExecuteInstall(installDir, addons, port, pgPass, mgrName, mgrPin, AppendLog);
                    this.BeginInvoke(new Action(delegate() {
                        installRunning = false;
                        installSucceeded = true;
                        progressBar.Value = 100;
                        string addonLabel = string.IsNullOrEmpty(addons) ? "Core Production & Stock only" : ("Core + " + addons);
                        lblFinishSummary.Text = string.Format(
                            "WoodTek ERP has been installed and configured successfully!\r\n\r\n" +
                            "• Installation Folder: {0}\r\n" +
                            "• Installed Modules: {1}\r\n" +
                            "• Local URL: http://localhost:{2}/\r\n" +
                            "• Initial Manager: {3} (PIN: {4})\r\n\r\n" +
                            "Note: Modules not selected during setup are hard-locked on this PC. " +
                            "To add or remove modules in the future, simply run WoodTek-ERP-Setup.exe again.",
                            installDir, addonLabel, port, mgrName, mgrPin
                        );
                        ShowPage(3);
                    }));
                }
                catch (Exception ex)
                {
                    AppendLog("ERROR: " + ex.Message);
                    this.BeginInvoke(new Action(delegate() {
                        installRunning = false;
                        lblCurrentStep.Text = "Installation failed — see log below.";
                        lblCurrentStep.ForeColor = Color.FromArgb(248, 113, 113);
                        btnCancel.Enabled = true;
                        btnCancel.Text = "Close";
                    }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    public static class InstallerRunner
    {
        private static readonly byte[] MagicBytes = Encoding.ASCII.GetBytes("WTSETUP1");

        public static string ExtractAppendedZipIfPresent(Action<string> logger)
        {
            string exePath = Process.GetCurrentProcess().MainModule.FileName;
            using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                if (fs.Length > 24)
                {
                    fs.Seek(-16, SeekOrigin.End);
                    byte[] trailer = new byte[16];
                    int read = fs.Read(trailer, 0, 16);
                    if (read == 16 && MatchesMagic(trailer))
                    {
                        long zipLength = BitConverter.ToInt64(trailer, 8);
                        long zipStart = fs.Length - 16 - zipLength;
                        if (zipLength > 0 && zipStart > 0)
                        {
                            string tempZip = Path.Combine(Path.GetTempPath(), "woodtek-payload-" + Guid.NewGuid().ToString("N") + ".zip");
                            logger("Extracting embedded installation package...");
                            fs.Seek(zipStart, SeekOrigin.Begin);
                            using (FileStream outFs = new FileStream(tempZip, FileMode.Create, FileAccess.Write, FileShare.None))
                            {
                                byte[] buffer = new byte[65536];
                                long remaining = zipLength;
                                while (remaining > 0)
                                {
                                    int toRead = (int)Math.Min(buffer.Length, remaining);
                                    int n = fs.Read(buffer, 0, toRead);
                                    if (n <= 0) break;
                                    outFs.Write(buffer, 0, n);
                                    remaining -= n;
                                }
                            }
                            return tempZip;
                        }
                    }
                }
            }

            string siblingZip = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WoodTek-Payload.zip");
            if (File.Exists(siblingZip)) return siblingZip;
            return "";
        }

        private static bool MatchesMagic(byte[] trailer)
        {
            for (int i = 0; i < 8; i++)
            {
                if (trailer[i] != MagicBytes[i]) return false;
            }
            return true;
        }

        public static void ExecuteInstall(
            string installDir,
            string addons,
            int port,
            string pgPass,
            string managerName,
            string managerPin,
            Action<string> logger
        )
        {
            string tempZip = "";
            string tempEngineDir = "";
            try
            {
                tempZip = ExtractAppendedZipIfPresent(logger);
                string enginePs1 = "";

                if (!string.IsNullOrEmpty(tempZip) && File.Exists(tempZip))
                {
                    tempEngineDir = Path.Combine(Path.GetTempPath(), "woodtek-engine-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(tempEngineDir);
                    using (ZipArchive archive = ZipFile.OpenRead(tempZip))
                    {
                        ZipArchiveEntry entry = archive.GetEntry("installer/install-engine.ps1");
                        if (entry == null) entry = archive.GetEntry(@"installer\install-engine.ps1");
                        if (entry != null)
                        {
                            enginePs1 = Path.Combine(tempEngineDir, "install-engine.ps1");
                            entry.ExtractToFile(enginePs1, true);
                        }
                    }
                }

                if (string.IsNullOrEmpty(enginePs1))
                {
                    string localCandidate = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"installer\install-engine.ps1");
                    if (!File.Exists(localCandidate))
                    {
                        localCandidate = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "install-engine.ps1");
                    }
                    if (File.Exists(localCandidate)) enginePs1 = localCandidate;
                }

                if (string.IsNullOrEmpty(enginePs1) || !File.Exists(enginePs1))
                {
                    throw new FileNotFoundException("Could not locate install-engine.ps1 inside the setup package.");
                }

                string psArgs = string.Format(
                    "-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -InstallDir \"{1}\" -Addons \"{2}\" -Port {3} -PgSuperPassword \"{4}\" -ManagerName \"{5}\" -ManagerPin \"{6}\" -PayloadZip \"{7}\"",
                    enginePs1, installDir, addons, port, pgPass, managerName, managerPin, tempZip
                );

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = psArgs;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.CreateNoWindow = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;

                using (Process proc = new Process())
                {
                    proc.StartInfo = psi;
                    proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs ev) {
                        if (ev.Data != null) logger(ev.Data);
                    };
                    proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs ev) {
                        if (ev.Data != null) logger(ev.Data);
                    };
                    proc.Start();
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();
                    proc.WaitForExit();
                    if (proc.ExitCode != 0)
                    {
                        throw new Exception(string.Format("Installer engine exited with code {0}.", proc.ExitCode));
                    }
                }
            }
            finally
            {
                try
                {
                    if (!string.IsNullOrEmpty(tempZip) && tempZip.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase) && File.Exists(tempZip))
                    {
                        File.Delete(tempZip);
                    }
                }
                catch { }
                try
                {
                    if (!string.IsNullOrEmpty(tempEngineDir) && Directory.Exists(tempEngineDir))
                    {
                        Directory.Delete(tempEngineDir, true);
                    }
                }
                catch { }
            }
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            bool silent = false;
            string dir = @"C:\WoodTek-ERP";
            string addons = "invoicing,purchasing,cmms,workforce";
            int port = 3000;
            string pgPass = "postgres";
            string mgrName = "Claude Aredjian";
            string mgrPin = "1234";

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a.Equals("/SILENT", StringComparison.OrdinalIgnoreCase) || a.Equals("/VERYSILENT", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
                else if (a.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                {
                    dir = a.Substring(5).Trim('"');
                }
                else if (a.StartsWith("/ADDONS=", StringComparison.OrdinalIgnoreCase))
                {
                    addons = a.Substring(8).Trim('"');
                }
                else if (a.StartsWith("/PORT=", StringComparison.OrdinalIgnoreCase))
                {
                    int.TryParse(a.Substring(6).Trim('"'), out port);
                }
                else if (a.StartsWith("/PGPASS=", StringComparison.OrdinalIgnoreCase))
                {
                    pgPass = a.Substring(8).Trim('"');
                }
                else if (a.StartsWith("/MANAGER=", StringComparison.OrdinalIgnoreCase))
                {
                    mgrName = a.Substring(9).Trim('"');
                }
                else if (a.StartsWith("/PIN=", StringComparison.OrdinalIgnoreCase))
                {
                    mgrPin = a.Substring(5).Trim('"');
                }
            }

            if (silent)
            {
                try
                {
                    InstallerRunner.ExecuteInstall(dir, addons, port, pgPass, mgrName, mgrPin, delegate(string msg) {
                        Console.WriteLine(msg);
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("FATAL: " + ex.Message);
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
            return 0;
        }
    }
}
