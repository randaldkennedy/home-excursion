using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddVendorContactsAndActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "VendorId",
                schema: "home",
                table: "ProjectContractors",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "VendorActivities",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    VendorId = table.Column<int>(type: "int", nullable: false),
                    ProjectId = table.Column<int>(type: "int", nullable: true),
                    ActivityType = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    ActivityAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Summary = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VendorActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VendorActivities_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "home",
                        principalTable: "Projects",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_VendorActivities_Vendors_VendorId",
                        column: x => x.VendorId,
                        principalSchema: "home",
                        principalTable: "Vendors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VendorContacts",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    VendorId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    IsPrimary = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VendorContacts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VendorContacts_Vendors_VendorId",
                        column: x => x.VendorId,
                        principalSchema: "home",
                        principalTable: "Vendors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectContractors_VendorId",
                schema: "home",
                table: "ProjectContractors",
                column: "VendorId");

            migrationBuilder.CreateIndex(
                name: "IX_VendorActivities_ProjectId",
                schema: "home",
                table: "VendorActivities",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_VendorActivities_VendorId_ActivityAt",
                schema: "home",
                table: "VendorActivities",
                columns: new[] { "VendorId", "ActivityAt" });

            migrationBuilder.CreateIndex(
                name: "IX_VendorContacts_VendorId_IsPrimary",
                schema: "home",
                table: "VendorContacts",
                columns: new[] { "VendorId", "IsPrimary" });

            migrationBuilder.AddForeignKey(
                name: "FK_ProjectContractors_Vendors_VendorId",
                schema: "home",
                table: "ProjectContractors",
                column: "VendorId",
                principalSchema: "home",
                principalTable: "Vendors",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProjectContractors_Vendors_VendorId",
                schema: "home",
                table: "ProjectContractors");

            migrationBuilder.DropTable(
                name: "VendorActivities",
                schema: "home");

            migrationBuilder.DropTable(
                name: "VendorContacts",
                schema: "home");

            migrationBuilder.DropIndex(
                name: "IX_ProjectContractors_VendorId",
                schema: "home",
                table: "ProjectContractors");

            migrationBuilder.DropColumn(
                name: "VendorId",
                schema: "home",
                table: "ProjectContractors");
        }
    }
}
