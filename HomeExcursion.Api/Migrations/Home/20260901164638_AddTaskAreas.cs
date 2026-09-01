using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddTaskAreas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Areas",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Areas", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TaskAreas",
                schema: "home",
                columns: table => new
                {
                    TaskId = table.Column<int>(type: "int", nullable: false),
                    AreaId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskAreas", x => new { x.TaskId, x.AreaId });
                    table.ForeignKey(
                        name: "FK_TaskAreas_Areas_AreaId",
                        column: x => x.AreaId,
                        principalSchema: "home",
                        principalTable: "Areas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TaskAreas_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "home",
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Areas_PropertyId_Name",
                schema: "home",
                table: "Areas",
                columns: new[] { "PropertyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskAreas_AreaId",
                schema: "home",
                table: "TaskAreas",
                column: "AreaId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TaskAreas",
                schema: "home");

            migrationBuilder.DropTable(
                name: "Areas",
                schema: "home");
        }
    }
}
